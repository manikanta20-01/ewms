const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { LeaveRequests, LeaveTypes } = srv.entities;

  // ============================================================
  // CREATE - Validation & Auto-Enrichment
  // ============================================================
  srv.before("CREATE", "LeaveRequests", async (req) => {
    const tx = cds.transaction(req);
    const { employee_ID, leaveType_ID, fromDate, toDate } = req.data;

    // 1. Mandatory Fields Presence Validation
    required(req, "employee_ID", "Employee");
    required(req, "leaveType_ID", "Leave Type");
    required(req, "fromDate", "From Date");
    required(req, "toDate", "To Date");

    // 2. Chronological Sequence Alignment Check
    if (fromDate > toDate) {
      return req.error(
        400,
        "From Date cannot be chronologically after To Date.",
      );
    }

    // 3. Existential Integrity Lookups
    const employeeExists = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: employee_ID }),
    );
    if (!employeeExists) {
      return req.error(404, "Target Employee record does not exist.");
    }

    const leaveTypeExists = await tx.run(
      SELECT.one
        .from(LeaveTypes || "ewms.db.leave.LeaveType")
        .where({ ID: leaveType_ID, status: "Active" }),
    );
    if (!leaveTypeExists) {
      return req.error(
        404,
        "Target Leave Type record is either inactive or does not exist.",
      );
    }

    // 4. Overlap Protection Guardrail
    const overlappingRequest = await tx.run(
      SELECT.one.from(LeaveRequests || "ewms.db.leave.LeaveRequest").where({
        employee_ID,
        status: { "!=": "Cancelled" },
        fromDate: { "<=": toDate },
        toDate: { ">=": fromDate },
      }),
    );

    if (overlappingRequest) {
      return req.error(
        400,
        "The employee has an existing or pending leave request that overlaps with this selected date range.",
      );
    }

    // 5. Transactional Metadata Enrichment
    req.data.status = req.data.status || "Pending";
    req.data.appliedOn = new Date().toISOString();

    // Total Days Calculation: half-day requests are always 0.5 days;
    // otherwise count inclusive calendar days between fromDate and toDate.
    if (req.data.halfDay) {
      req.data.totalDays = 0.5;
    } else {
      const msPerDay = 24 * 60 * 60 * 1000;
      const diffDays =
        Math.round(
          (new Date(toDate).getTime() - new Date(fromDate).getTime()) /
            msPerDay,
        ) + 1;
      req.data.totalDays = diffDays;
    }

    req.data.leaveNumber = await generateCode(
      req,
      "ewms.db.leave.LeaveRequest",
      "leaveNumber",
      "LV",
      6,
    );
  });

  // ============================================================
  // AFTER CREATE - Auto-Generate Two-Level Approval Workflow
  // (Level 1: Reporting Manager, Level 2: HR)
  // ============================================================
  srv.after("CREATE", "LeaveRequests", async (data, req) => {
    const tx = cds.transaction(req);
    const records = Array.isArray(data) ? data : [data];

    for (const rec of records) {
      if (!rec.ID) continue;

      // Reserve the requested days against the employee's leave balance
      if (rec.totalDays != null) {
        const leaveYear = new Date(rec.fromDate).getFullYear();
        await tx.run(
          UPDATE("ewms.db.leave.LeaveBalance")
            .set({ pendingDays: { "+=": rec.totalDays } })
            .where({
              employee_ID: rec.employee_ID,
              leaveType_ID: rec.leaveType_ID,
              year: leaveYear,
            }),
        );
      }

      // Level 1 approver: employee's active reporting manager
      const assignment = await tx.run(
        SELECT.one
          .from("ewms.db.employee.EmployeeAssignment")
          .where({ employee_ID: rec.employee_ID, isActive: true }),
      );
      const level1Approver = assignment?.reportingManager_ID;

      if (level1Approver) {
        await tx.run(
          INSERT.into("ewms.db.leave.LeaveApproval").entries({
            ID: cds.utils.uuid(),
            leaveRequest_ID: rec.ID,
            approver_ID: level1Approver,
            level: 1,
            decision: "Pending",
          }),
        );
      }

      // Level 2 approver: active HR representative
      const hr = await tx.run(
        SELECT.one
          .from("ewms.db.organization.DepartmentHR")
          .where({ isActive: true }),
      );
      const level2Approver = hr?.employee_ID;

      if (level2Approver) {
        await tx.run(
          INSERT.into("ewms.db.leave.LeaveApproval").entries({
            ID: cds.utils.uuid(),
            leaveRequest_ID: rec.ID,
            approver_ID: level2Approver,
            level: 2,
            decision: "Pending",
          }),
        );
      }
    }
  });

  // ============================================================
  // UPDATE - Strict Parameter Guardrails & State Transitions
  // ============================================================
  srv.before("UPDATE", "LeaveRequests", async (req) => {
    const tx = cds.transaction(req);
    const targetId = req.data.ID || req.params?.[0]?.ID || req.params?.[0];

    if (!targetId) return;

    // Fetch live state record from database
    const currentRecord = await tx.run(
      SELECT.one
        .from(LeaveRequests || "ewms.db.leave.LeaveRequest")
        .where({ ID: targetId }),
    );

    if (!currentRecord) {
      return req.error(404, "Target leave application record was not found.");
    }

    // Structural Freeze Rule: Block modifications to core dates/keys once transitioned
    if (
      currentRecord.status !== "Draft" &&
      currentRecord.status !== "Pending"
    ) {
      if (
        "fromDate" in req.data ||
        "toDate" in req.data ||
        "leaveType_ID" in req.data ||
        "employee_ID" in req.data
      ) {
        return req.error(
          400,
          "Modifying foundational transactional parameters is prohibited after an operational status transition.",
        );
      }
    }
  });

  // ============================================================
  // DELETE - Decoupling Safety Checks
  // ============================================================
  srv.before("DELETE", "LeaveRequests", async (req) => {
    const tx = cds.transaction(req);
    const targetId = req.data?.ID || req.params?.[0]?.ID || req.params?.[0];

    if (!targetId) return;

    const targetRecord = await tx.run(
      SELECT.one
        .from(LeaveRequests || "ewms.db.leave.LeaveRequest")
        .where({ ID: targetId }),
    );

    if (!targetRecord) {
      return req.error(404, "Target request reference does not exist.");
    }

    // Strict compliance rule: Only Drafts can be physically deleted
    if (targetRecord.status !== "Draft") {
      return req.error(
        400,
        "Only applications held in a structural 'Draft' status can be physically decoupled from the database ledger.",
      );
    }
  });
};
