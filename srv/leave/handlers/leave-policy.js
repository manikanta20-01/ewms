const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required, positive } = require("../../common/utils/validation");

module.exports = (srv) => {
  const { LeavePolicy } = srv.entities;

  // =========
  // CREATE 
  // =========
  srv.before("CREATE", "LeavePolicies", async (req) => {
    const tx = cds.transaction(req);
    const {
      company_ID,
      businessUnit_ID,
      leaveType_ID,
      daysPerYear,
      carryForwardLimit,
      maxContinuousDays,
      minNoticeDays,
    } = req.data;

    // 1. Mandatory Field Criteria Check
    required(req, "leaveType_ID", "Leave Type Reference");
    required(req, "daysPerYear", "Days Per Year Allocation");

    // 2. Positive Numeric Constraint Evaluations
    positive(req, "daysPerYear", "Days Per Year");
    if (carryForwardLimit !== undefined && Number(carryForwardLimit) < 0) {
      return req.error(400, "Carry Forward Limit cannot be a negative value.");
    }
    if (maxContinuousDays !== undefined && Number(maxContinuousDays) <= 0) {
      return req.error(
        400,
        "Maximum Continuous Days must be greater than zero.",
      );
    }
    if (minNoticeDays !== undefined && Number(minNoticeDays) < 0) {
      return req.error(400, "Minimum Notice Days cannot be a negative value.");
    }

    // 3. Direct DB Existential Integrity Lookups (Bypasses UI service role locks)
    if (company_ID) {
      const companyExists = await tx.run(
        SELECT.one
          .from("ewms.db.organization.Company")
          .where({ ID: company_ID }),
      );
      if (!companyExists)
        return req.error(404, "Target Parent Company record does not exist.");
    }

    if (businessUnit_ID) {
      const buExists = await tx.run(
        SELECT.one
          .from("ewms.db.organization.BusinessUnit")
          .where({ ID: businessUnit_ID }),
      );
      if (!buExists)
        return req.error(404, "Target Business Unit record does not exist.");
    }

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

    // 4. Duplicate Policy Rule Scope Matrix Check
    const policyConflict = await tx.run(
      SELECT.one.from("ewms.db.leave.LeavePolicy").where({
        company_ID: company_ID || null,
        businessUnit_ID: businessUnit_ID || null,
        leaveType_ID: leaveType_ID,
        status: "Active",
      }),
    );

    if (policyConflict) {
      return req.error(
        400,
        "An active corporate governance rule policy already covers this explicit organizational scope matrix.",
      );
    }
  });

  // ========
  // UPDATE 
  // ========
  srv.before("UPDATE", "LeavePolicies", async (req) => {
    const tx = cds.transaction(req);

    // Prevent modification of foundational context keys once bound
    if (
      "company_ID" in req.data ||
      "businessUnit_ID" in req.data ||
      "leaveType_ID" in req.data
    ) {
      return req.error(
        400,
        "Altering foundational organizational mappings on an active policy is prohibited.",
      );
    }

    if (
      req.data.daysPerYear !== undefined &&
      Number(req.data.daysPerYear) <= 0
    ) {
      return req.error(
        400,
        "Days Per Year allocation must be greater than zero.",
      );
    }
    if (
      req.data.carryForwardLimit !== undefined &&
      Number(req.data.carryForwardLimit) < 0
    ) {
      return req.error(400, "Carry Forward Limit cannot be a negative value.");
    }
  });
};
