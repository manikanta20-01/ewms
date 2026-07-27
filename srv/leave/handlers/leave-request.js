const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { LeaveRequest } = srv.entities;

  // // ========
  // // CREATE
  // // ========
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

    // 3. Direct DB Existential Integrity Lookups (Bypasses UI role locks)[cite: 1]
    const employeeExists = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: employee_ID }),
    );
    if (!employeeExists)
      return req.error(404, "Target Employee record does not exist.");

    const leaveTypeExists = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeaveType")
        .where({ ID: leaveType_ID, status: "Active" }),
    );
    if (!leaveTypeExists)
      return req.error(
        404,
        "Target Leave Type record is either inactive or does not exist.",
      );

    // 4. Overlap Protection Guardrail via Absolute Data Boundaries
    const overlappingRequest = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveRequest").where({
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

  // // ========
  // // UPDATE
  // // ========
  srv.before("UPDATE", "LeaveRequests", async (req) => {
    const tx = cds.transaction(req);

    // Fetch finalized live state record to check structural boundaries[cite: 1]
    const currentRecord = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveRequest").where({ ID: req.data.ID }),
    );
    if (!currentRecord)
      return req.error(404, "Target leave application record was not found.");

    // Structural Freeze Rule: Block modifications to relational mapping criteria after execution transitions
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

  // // ========
  // // DELETE
  // // ========
  srv.before("DELETE", "LeaveRequests", async (req) => {
    const tx = cds.transaction(req);
    const targetRecord = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveRequest").where({ ID: req.data.ID }),
    );

    if (!targetRecord)
      return req.error(404, "Target request reference does not exist.");

    // Strict compliance boundary ledger rule
    if (targetRecord.status !== "Draft") {
      return req.error(
        400,
        "Only applications held in a structural 'Draft' status can be physically decoupled from the database ledger.",
      );
    }
  });
};
