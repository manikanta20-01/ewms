const cds = require("@sap/cds");

// ============================================================
// SPRINT 22 - DASHBOARD SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// No audit hooks here: computed entities have NO back-end table,
// so there is nothing to audit on read (reads of aggregates are
// also deliberately not logged - the audit log must not grow
// with every dashboard refresh; Sprint 23 audits EXPORTS).
// Handler logic lives in one small focused file, mirroring the
// helpdesk module's structure.
// ============================================================
module.exports = cds.service.impl(async function () {
  require("./handlers/dashboard-reader")(this);
});
