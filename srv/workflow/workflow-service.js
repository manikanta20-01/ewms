const cds = require("@sap/cds");
const {
  registerWorkflowActions,
  registerGuards,
} = require("./handlers/workflow-engine");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 10 - WORKFLOW SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Wires together:
//   * the generic engine (all workflow actions)
//   * integrity guards (immutable history, engine-only writes)
//   * the enterprise audit framework (Sprint 9) - opt-in list
//     covers the configuration entities; runtime entities are
//     fully traced through WorkflowHistory itself
// ============================================================

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["WorkflowDefinitions", "WorkflowSteps", "WorkflowDelegations"],
  });

  registerWorkflowActions(this);
  registerGuards(this);
  require("./handlers/delegations")(this);
});
