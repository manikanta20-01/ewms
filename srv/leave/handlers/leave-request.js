const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { LeaveRequests, LeaveTypes } = srv.entities;

  // ============================================================
  // CREATE - Validation & Auto-Enrichment
  // ============================================================
  srv.before("CREATE", "LeaveRequests", async (req) => {
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
    const employeeExists = await req.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: employee_ID }),
    );
    if (!employeeExists) {
      return req.error(404, "Target Employee record does not exist.");
    }

    const leaveTypeExists = await req.run(
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
    const overlappingRequest = await req.run(
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
    req.data.status = req.data.status || "Draft";
    req.data.appliedOn = new Date().toISOString();

    req.data.leaveNumber = await generateCode(
      req,
      "ewms.db.leave.LeaveRequest",
      "leaveNumber",
      "LV",
      6,
    );
  });

  // ============================================================
  // UPDATE - Strict Parameter Guardrails & State Transitions
  // ============================================================
  srv.before("UPDATE", "LeaveRequests", async (req) => {
    const targetId = req.data.ID || req.params?.[0]?.ID || req.params?.[0];

    if (!targetId) return;

    // Fetch live state record from database
    const currentRecord = await req.run(
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
    const targetId = req.data?.ID || req.params?.[0]?.ID || req.params?.[0];

    if (!targetId) return;

    const targetRecord = await req.run(
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
