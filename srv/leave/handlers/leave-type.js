const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { LeaveType } = srv.entities;

  // ============================================================
  // CREATE - Validation & Code Generation
  // ============================================================
  srv.before("CREATE", "LeaveTypes", async (req) => {
    const tx = cds.transaction(req);
    const { name, maxDaysPerRequest } = req.data;

    // Mandatory Field Validation
    required(req, "name", "Leave Type Name");
    positive(req, "maxDaysPerRequest", "Maximum Days per Request");

    if (maxDaysPerRequest !== undefined && maxDaysPerRequest <= 0) {
      return req.error(
        400,
        "Maximum days per request must be greater than zero.",
      );
    }

    // Duplicate Check via absolute Database Layer String (Avoids Draft Isolation Flaws)
    const existingType = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveType").where({ name: name }),
    );

    if (existingType) {
      return req.error(
        400,
        `Leave category '${name}' already exists in the system registry.`,
      );
    }

    // Auto Code Allocation targeting the direct database table layer
    req.data.leaveCode = await generateCode(
      req,
      "ewms.db.leave.LeaveType",
      "leaveCode",
      "LV",
      4,
    );
  });

  // ============================================================
  // UPDATE - Strict Modification Rules
  // ============================================================
  srv.before("UPDATE", "LeaveTypes", async (req) => {
    const tx = cds.transaction(req);

    // Immutable Key Block Rule
    if ("leaveCode" in req.data) {
      return req.error(
        400,
        "Altering an active unique Leave Code configuration is prohibited.",
      );
    }

    if (
      req.data.maxDaysPerRequest !== undefined &&
      req.data.maxDaysPerRequest <= 0
    ) {
      return req.error(
        400,
        "Maximum days per request must be greater than zero.",
      );
    }

    // Check for Name duplication on modification
    if (req.data.name) {
      const duplicateCheck = await tx.run(
        SELECT.one
          .from("ewms.db.leave.LeaveType")
          .where({ name: req.data.name, ID: { "!=": req.data.ID } }),
      );

      if (duplicateCheck) {
        return req.error(
          400,
          `Another leave category with the name '${req.data.name}' already exists.`,
        );
      }
    }
  });

  // ============================================================
  // DELETE - Multi-Module Dependency Guardrails
  // ============================================================
  srv.before("DELETE", "LeaveTypes", async (req) => {
    const tx = cds.transaction(req);

    // Defensive Check 1: Stop deletion if any active balances are bound to this category
    const balanceLinked = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeaveBalance")
        .where({ leaveType_ID: req.data.ID }),
    );

    if (balanceLinked) {
      return req.error(
        400,
        "Cannot delete Leave Type. Active Employee Leave Balances are dependent on this configuration.",
      );
    }

    // Defensive Check 2: Stop deletion if any operational rules exist
    const policyLinked = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeavePolicy")
        .where({ leaveType_ID: req.data.ID }),
    );

    if (policyLinked) {
      return req.error(
        400,
        "Cannot delete Leave Type. Active Leave Policies are dependent on this configuration.",
      );
    }

    // Defensive Check 3: Stop deletion if historical leave requests exist
    const requestsLinked = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeaveRequest")
        .where({ leaveType_ID: req.data.ID }),
    );

    if (requestsLinked) {
      return req.error(
        400,
        "Cannot delete Leave Type. Historical Leave Request records are bound to this configuration.",
      );
    }
  });
};
