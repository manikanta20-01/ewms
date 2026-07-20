const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required } = require("../../common/utils/validation");

module.exports = (srv) => {
  // // ========
  // // CREATE
  // // ========
  srv.before("CREATE", "ApprovalHistories", async (req) => {
    const tx = cds.transaction(req);
    const { leaveRequest_ID, performedBy_ID, action } = req.data;

    required(req, "leaveRequest_ID", "Leave Request Reference");
    required(req, "performedBy_ID", "Performer Reference");
    required(req, "action", "Audit Action Status");

    const requestExists = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeaveRequest")
        .where({ ID: leaveRequest_ID }),
    );
    if (!requestExists)
      return req.error(404, "Associated Leave Request record does not exist.");

    const performerExists = await tx.run(
      SELECT.one
        .from("ewms.db.employee.Employee")
        .where({ ID: performedBy_ID }),
    );
    if (!performerExists)
      return req.error(404, "Performer Employee record does not exist.");

    req.data.performedOn = new Date().toISOString();
  });

  // // ========
  // // UPDATE
  // // ========
  srv.before("UPDATE", "ApprovalHistories", async (req) => {
    return req.error(
      400,
      "Compliance Violation: Operational history logs are immutable and cannot be modified.",
    );
  });

  // // ========
  // // DELETE
  // // ========
  srv.before("DELETE", "ApprovalHistories", async (req) => {
    return req.error(
      400,
      "Compliance Violation: Operational history logs cannot be decoupled from the ledger database.",
    );
  });
};
