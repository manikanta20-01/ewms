const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: [
      "LeaveRequests",
      "LeaveApprovals",
      "LeaveBalances",
      "LeavePolicies",
      "LeaveTypes",
      "ApprovalHistories",
    ],
  });

  require("./handlers/leave-type")(this);
  require("./handlers/leave-request")(this);
  require("./handlers/leave-policy")(this);
  require("./handlers/leave-balance")(this);
  require("./handlers/leave-approval")(this);
  require("./handlers/approval-history")(this);

  // SPRINT 10: generic workflow integration (bound StartWorkflow
  // action + business callbacks). Requires the WorkflowService to
  // be loaded so its engine entities exist.
  require("./handlers/leave-workflow")(this);
});
