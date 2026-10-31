const cds = require("@sap/cds");

// ============================================================
// SPRINT 23 - REPORTS SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reads and exports are COMPUTED (no back-end table), so there
// are no generic CRUD audit hooks here. Exports are audited
// explicitly (facts only - no report contents) in the export
// handler; see handlers/reports-reader.js.
// ============================================================
module.exports = cds.service.impl(async function () {
  require("./handlers/reports-reader")(this);
});
