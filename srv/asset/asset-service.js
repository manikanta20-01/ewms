const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 14 - ASSET SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Wires the lifecycle handlers and registers the standard audit
// hooks for the asset master data (Sprint 9 audit framework).
// Lifecycle actions write their own explicit audit rows with
// before/after state (see handlers/asset-lifecycle.js).
// ============================================================

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Assets", "AssetCategories", "AssetAssignments"],
  });

  require("./handlers/asset-master")(this);
  require("./handlers/asset-lifecycle")(this);
});
