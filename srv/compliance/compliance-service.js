const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 17 - COMPLIANCE SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reuses the shared audit helper for requirement configuration
// changes. Notification writes go through the shared notify()
// core (never a second notification framework).
// ============================================================
module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, { include: ["DocumentRequirements"] });

  require("./handlers/requirements")(this);
  require("./handlers/summaries")(this);
});
