const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // TODO:
  const { LeaveType, LeavePolicy } = srv.entities;

  // ==================
  // CREATE
  // ==================
  srv.before("CREATE", "LeaveType", async (req) => {
    const tx = cds.transaction(req);

    const { leaveCode, name } = req.data;

    // validate leavecode
    if (!leaveCode) {
      return req.error(400, "Leave code is required");
    }
    // Validate name
    if (!name) {
      return req.error(400, "Leave name is required");
    }

    // Duplicate Leave code
    const duplicateCode = await tx.run(
      SELECT.one.from(LeaveType).where({
        leaveCode,
      }),
    );

    if (duplicateCode)
      return req.error(400, `Leave code '${leaveCode}' Already exists`);

    // Duplicate leave name
    const duplicateName = await tx.run(
      SELECT.one.from(LeaveType).where({ name }),
    );

    if (duplicateName)
      return req.error(400, `Leave name '${name}' Already exists`);
  });
  // ==================
  // UPDATE
  // ==================
  srv.before("UPDATE", "LeaveType", async (req) => {
    const { ID, leaveCode, name } = req.data;
    const tx = cds.transaction(req);

    if (leaveCode) {
      const duplicateCode = await tx.run(
        SELECT.one.from(LeaveType).where({
          leaveCode,
          "!=": ID,
        }),
      );
      if (duplicateCode)
        return req.error(400, `Leave code ${leaveCode} Already exeists`);
    }

    if (name) {
      const duplicateName = await tx.run(
        SELECT.one.from(LeaveType).where({
          name,
          "!=": ID,
        }),
      );
      if (duplicateName)
        return req.error(400, `Leave name ${name} Already exists`);
    }
  });
  // ==================
  // DELETE
  // ==================
  srv.before("DELETE", "LeaveType", async (req) => {
    const tx = cds.transaction(req);

    const policy = await tx.run(
      SELECT.one.from(LeavePolicies).where({ leaveType_ID: ID }),
    );

    if (policy) {
      return req.error(400, "Leave Type is used in Leave Policy.");
    }

    const balance = await tx.run(
      SELECT.one.from(LeaveBalances).where({ leaveType_ID: ID }),
    );

    if (balance) {
      return req.error(400, "Leave Type is used in Leave Balance.");
    }

    const request = await tx.run(
      SELECT.one.from(LeaveRequests).where({ leaveType_ID: ID }),
    );

    if (request) {
      return req.error(400, "Leave Type is used in Leave Request.");
    }
  });
};
