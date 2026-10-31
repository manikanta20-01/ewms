// ============================================================
// SPRINT 16 - GEOFENCE HISTORY LEDGER GUARDS
// ------------------------------------------------------------
// The ledger is append-only: only the geofence handlers write rows
// (at service level inside their transactions). Defense-in-depth:
// even if a future security file accidentally granted writes, these
// before-handlers refuse them with a clear 400 (same pattern as the
// workflow history and the timesheet history ledger).
// ============================================================

module.exports = (srv) => {
  const { GeofenceHistories } = srv.entities;

  srv.before("CREATE", GeofenceHistories, (req) =>
    req.error(400, "Geofence history rows are written by the system only."),
  );
  srv.before("UPDATE", GeofenceHistories, (req) =>
    req.error(400, "Geofence history is append-only and cannot be updated."),
  );
  srv.before("DELETE", GeofenceHistories, (req) =>
    req.error(400, "Geofence history is append-only and cannot be deleted."),
  );
};
