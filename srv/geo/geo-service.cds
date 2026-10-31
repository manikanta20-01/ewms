using { ewms.db.geo as db } from '../../db/schema';

// ============================================================
// SPRINT 16 - GEO TRACKING & GEO-FENCING (SERVICE)
// ------------------------------------------------------------
// Config-only read/write service. The per-attendance geofence
// evaluation does NOT live here - it happens inside the
// AttendanceService handlers (see srv/geo/geofence-validator.js),
// because an invalid location must reject the attendance request,
// not a separate API call.
//
//   Geofences ................ configuration CRUD (admins only)
//                              plus Activate/Deactivate actions.
//   EmployeeLocationEligibilities ... optional per-employee fence
//                              restrictions (admins only).
//   AttendanceLocationEvents .. evidence rows; read-only for the
//                              owning employee + HR (security file).
//   GeofenceHistories ......... append-only configuration ledger.
// ============================================================

service GeoService @(requires: 'authenticated-user') {

    entity Geofences as projection on db.Geofence actions {
        // Status changes go through dedicated actions (guarded,
        // conditional updates - same pattern as every other module)
        // so a plain PATCH cannot bypass the history write.
        action ActivateGeofence() returns String;
        action DeactivateGeofence() returns String;
    };

    entity EmployeeLocationEligibilities as projection on db.EmployeeLocationEligibility;

    // Evidence rows are read-only for every role; they are written
    // by the server only (no CREATE/UPDATE/DELETE grants anywhere).
    entity AttendanceLocationEvents as projection on db.AttendanceLocationEvent;

    // Append-only configuration ledger; also read-only.
    entity GeofenceHistories as projection on db.GeofenceHistory;
}
