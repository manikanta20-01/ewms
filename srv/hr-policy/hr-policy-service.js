const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 19 - HR POLICY SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reuses the shared audit helper (CREATE/UPDATE/DELETE audit for
// the header and version CRUD plus explicit persistAudit calls
// in each lifecycle action) and the shared notify() core.
// Handler logic stays in two small focused files, mirroring the
// engagement module.
// ============================================================
module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    // Acknowledgment statements are evidence copies, not
    // compensation/secrets - safe to audit in full.
    include: ["Policies", "PolicyVersions", "PolicyAcknowledgments"],
  });

  require("./handlers/policy-lifecycle")(this);
  require("./handlers/acknowledgments")(this);
});
