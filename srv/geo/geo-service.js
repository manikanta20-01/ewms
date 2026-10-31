const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 16 - GEO SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reuses the shared Sprint 9 audit helper for configuration
// changes. AttendanceLocationEvents are deliberately NOT audited:
// (a) they are written by the validator, not through this service,
// and (b) the sanitized audit JSON would still carry coordinates -
// the event entity itself IS the evidence record with its own
// row-level access rules.
// ============================================================
module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Geofences", "EmployeeLocationEligibilities"],
  });

  require("./handlers/geofence")(this);
  require("./handlers/eligibility")(this);
  require("./handlers/geofence-history")(this);
});
