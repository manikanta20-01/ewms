namespace ewms.db.geo;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';

// Reused master data - the geo module NEVER duplicates employee,
// attendance or organization master data; it only references it.
using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.attendance.Attendance } from '../attendance/attendance';
using { ewms.db.organization.Location } from '../organization/location';

// ============================================================
// SPRINT 16 - GEO TRACKING & GEO-FENCING
// ------------------------------------------------------------
// Minimal backend model for authorized workforce use cases:

//   * Geofence ............ a configurable work location with
//     coordinates + radius, active status and effective dates.
//   * EmployeeLocationEligibility ... optional restriction of the
//     employees ALLOWED to use a specific geofence (no rows = every
//     active geofence is usable - the default permissive policy).
//   * AttendanceLocationEvent ... ONE evidence row per check-in /
//     check-out that carried location data. Written ONLY by the
//     server (the geofence evaluation result can never be claimed
//     by a client). Coordinates stored are rounded to ~11 m
//     precision (4 decimals) - never continuous GPS tracks.
//
// PRIVACY / RETENTION rules (beginner friendly):
//   * An event is written only when the employee actually submitted
//     coordinates for an attendance operation. Nothing polls or
//     pushes locations in the background.
//   * Failed evaluations are REJECTED requests - the transaction is
//     rolled back, so no event row (and no coordinates) is kept.
//   * Geofence configuration changes are audited: one GeofenceHistory
//     row per change, plus the shared AuditLog (registerAuditHooks).
//   * The decision is deliberately NOT to store raw full-precision
//     coordinates (Decimal(9,6)/Decimal(10,6) on Geofence describes
//     the fence CENTER only, which is company configuration data,
//     not personal data).
// ============================================================

entity Geofence : managed {
    key ID : UUID;

    // Human-readable identifier, e.g. GF0001 (@assert.unique).
    geofenceCode : String(20) @assert.unique;

    name : String(100) not null;

    // Optional link to the organization Location master. Purely
    // informational (this is what ties geofences to the company /
    // business-unit structure).
    location : Association to Location;

    // Geofence center. These are COMPANY configuration values
    // (where the office is), not personal location data.
    latitude  : Decimal(9, 6)  not null @assert.range: [ -90, 90 ];
    longitude : Decimal(10, 6) not null @assert.range: [ -180, 180 ];

    // Accepted radius in meters (10 m .. 100 km) around the center.
    radiusMeters : Integer not null @assert.range: [ 10, 100000 ];

    // A geofence only evaluates when status = Active AND the event
    // date falls inside the effective window.
    status : enums.Status default 'Active';
    effectiveFrom : Date not null;
    effectiveTo   : Date;             // null = from effectiveFrom on

    description : String(255);

    histories : Composition of many GeofenceHistory on histories.geofence = $self;
}

// Optional per-employee restriction: with ANY active eligibility row
// for the event date, the employee may ONLY use the geofences listed
// there. With NO eligibility rows the default policy applies (every
// active + effective geofence is usable).
entity EmployeeLocationEligibility : managed {
    key ID : UUID;

    employee : Association to Employee not null;
    geofence : Association to Geofence not null;

    fromDate : Date not null;
    toDate   : Date;                  // null = indefinitely

    // Soft switch, like the shift assignment module uses it.
    isActive : Boolean default true;
}

// ============================================================
// ONE LOCATION-EVIDENCE ROW per attendance operation that carried
// coordinates. Created EXCLUSIVELY by the geofence validator that
// the AttendanceService calls (see srv/geo/geofence-validator.js
// and srv/attendance/handlers/attendance.js) - there is no
// CREATE/UPDATE/DELETE grant on this entity for ANY role.
// ============================================================
entity AttendanceLocationEvent : managed {
    key ID : UUID;

    employee : Association to Employee not null;

    // The attendance row this evidence belongs to. Nullable because
    // evaluation happens BEFORE the attendance row is guaranteed -
    // the validator fills it as soon as the ID is known.
    attendance : Association to Attendance;

    // The geofence that PASSED (nearest matching fence). Null on
    // Bypassed events.
    geofence : Association to Geofence;

    // Which attendance operation produced this evidence.
    eventType : enums.GeoEventType not null;

    // Server-computed result. NEVER accepted from the request.
    //   Passed   : inside an allowed, active, effective geofence.
    //   Bypassed : validation not applicable (no active geofence,
    //              employee not eligible, remote-work exception).
    result : enums.GeoEvaluationResult not null;

    // Client-declared location time (staleness-checked). Optional.
    eventTimestamp : Timestamp;

    // Stored evidence, rounded to 4 decimals (~11 m) on write.
    latitude  : Decimal(9, 6)  not null;
    longitude : Decimal(10, 6) not null;

    // Distance in meters from the matched geofence center
    // (null on Bypassed - there is no matched fence).
    distanceMeters : Integer;

    // Why the evaluation was bypassed / free notes.
    reason : String(255);
}

// ============================================================
// APPEND-ONLY CONFIGURATION LEDGER
// ------------------------------------------------------------
// One row per geofence configuration change (created / updated /
// activated / deactivated). Rows are never updated or deleted by
// the application.
// ============================================================
entity GeofenceHistory : managed {
    key ID : UUID;

    geofence : Association to Geofence not null;

    action : enums.GeofenceAction not null;

    // Who changed it. The employee link is nullable because
    // SystemAdmin has deliberately no Employee row in this system -
    // the raw user id is always stored as a string.
    actorUser   : String(100) not null;
    actor       : Association to Employee;

    actedOn : Timestamp not null;

    // Short machine-readable summary, e.g. "fields: radiusMeters;
    // 200 -> 300".
    changeSummary : String(1000);
}
