using GeoService from './geo-service';

// ============================================================
// SPRINT 16 - GEO SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// PRIVACY is the design driver here:
//
//  * Geofence CONFIGURATION is company master data: every
//    authenticated user may READ which work places exist, but only
//    HRAdmin / SystemAdmin may create, change, activate or
//    deactivate fences (B5: configuration = administrators only).
//  * AttendanceLocationEvents hold ROUNDED employee coordinates.
//    The owning employee reads their OWN events; HR roles read all
//    (justified by their attendance responsibilities). Managers
//    deliberately get NO read on events - their legitimate line of
//    sight is the Attendance entity in AttendanceService (which
//    keeps its existing department/project scope). This keeps the
//    precise-location exposure strictly smaller than attendance
//    access.
//  * There is no CREATE/UPDATE/DELETE grant on events or on the
//    history ledger for ANY role: both are written by the server
//    (validator / history handlers) exclusively.
//  * Deny-by-default applies (restrict_all_services) - any role not
//    listed gets nothing.
// ============================================================

annotate GeoService with @(requires: 'authenticated-user');

annotate GeoService.Geofences with @restrict: [
    // Everybody authenticated may see the configured work places
    // (needed to know "where can I check in") - coordinates of the
    // fence center are company configuration, not personal data.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },

    // Configuration writes: HRAdmin + SystemAdmin only.
    { grant: ['CREATE', 'UPDATE', 'DELETE',
              'ActivateGeofence', 'DeactivateGeofence'],
      to: ['HRAdmin', 'SystemAdmin'] },
];

annotate GeoService.EmployeeLocationEligibilities with @restrict: [
    // HR manages eligibility; admins read it.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // An employee may see which fences they are explicitly bound to
    // (own rows only). Managers intentionally have no general read.
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },

    // Configuration writes: HRAdmin + SystemAdmin only.
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] },
];

annotate GeoService.AttendanceLocationEvents with @restrict: [
    // HR roles: justified access via their attendance responsibilities.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The employee sees their OWN evidence rows only - never another
    // employee's coordinates.
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
    // Deliberately NO grant for DepartmentManager / ProjectManager,
    // and no write grants for anybody (server-generated rows only).
];

annotate GeoService.GeofenceHistories with @restrict: [
    // Append-only configuration ledger - HR roles read it.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
