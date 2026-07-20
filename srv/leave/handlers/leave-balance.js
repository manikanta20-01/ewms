const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { required, positive } = require("../../common/utils/validation");

module.exports = (srv) => {
  const { LeaveBalance } = srv.entities;

  // // ========
  // // CREATE
  // // ========
  srv.before("CREATE", "LeaveBalances", async (req) => {
    const tx = cds.transaction(req);
    const { employee_ID, leaveType_ID, year, allocatedDays } = req.data;

    required(req, "employee_ID", "Employee");
    required(req, "leaveType_ID", "Leave Type");
    required(req, "year", "Calendar Year");
    required(req, "allocatedDays", "Allocated Days");

    positive(req, "allocatedDays", "Allocated Days");

    req.data.usedDays = req.data.usedDays ?? 0;
    req.data.pendingDays = req.data.pendingDays ?? 0;
    req.data.status = req.data.status || "Active";

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

    const existingBalance = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveBalance").where({
        employee_ID,
        leaveType_ID,
        year,
        status: "Active",
      }),
    );

    if (existingBalance) {
      return req.error(
        400,
        "An active leave balance record already exists for this employee, leave type, and calendar year configuration.",
      );
    }
  });

  // // ========
  // // UPDATE
  // // ========
  srv.before("UPDATE", "LeaveBalances", async (req) => {
    const tx = cds.transaction(req);

    if (
      "employee_ID" in req.data ||
      "leaveType_ID" in req.data ||
      "year" in req.data
    ) {
      return req.error(
        400,
        "Altering an active ledger balance's foundational structural mappings (Employee, Leave Type, or Year) is strictly prohibited.",
      );
    }

    if (req.data.allocatedDays !== undefined) {
      positive(req, "allocatedDays", "Allocated Days");
    }
  });

  // // ========
  // // DELETE
  // // ========
  srv.before("DELETE", "LeaveBalances", async (req) => {
    const tx = cds.transaction(req);

    const currentBalance = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveBalance").where({ ID: req.data.ID }),
    );
    if (!currentBalance)
      return req.error(404, "Target balance record not found.");

    const hasDependentRequests = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveRequest").where({
        employee_ID: currentBalance.employee_ID,
        leaveType_ID: currentBalance.leaveType_ID,
      }),
    );

    if (hasDependentRequests) {
      return req.error(
        400,
        "Cannot physically purge this balance ledger. Transactional leave request records are actively linked to this timeline scope.",
      );
    }
  });
};
