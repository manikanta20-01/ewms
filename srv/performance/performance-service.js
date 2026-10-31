const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 13 - PERFORMANCE SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Wires the lifecycle handlers and registers the standard audit
// hooks for all performance entities (Sprint 9 audit framework).
// ============================================================

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Reviews", "Goals"],
  });

  require("./handlers/review-lifecycle")(this);
  require("./handlers/goal-lifecycle")(this);
});
