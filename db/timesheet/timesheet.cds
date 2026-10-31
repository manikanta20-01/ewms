namespace ewms.db.timesheet;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';

// Reused master data - the timesheet NEVER duplicates employee,
// project, shift or payroll master data; it only references it.
using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.employee.EmployeeAssignment } from '../employee/employee-assignment';
using { ewms.db.project.Project } from '../project/project';
using { ewms.db.attendance.Shift } from '../attendance/shift';
using { ewms.db.payroll.PayrollPeriod } from '../payroll/payroll-period';

// ============================================================
// SPRINT 15 - TIMESHEET, SHIFT & ROSTER INTEGRATION
// ------------------------------------------------------------
// One Timesheet = one employee's work report for ONE reporting
// period (fromDate..toDate, e.g. a week). The work itself is
// recorded in TimesheetItems, one row per work date (per project).
//
// Business rules enforced in srv/timesheet/handlers/*:
//   * a period must not overlap another not-yet-final timesheet of
//     the same employee (prevents double-submitted hours),
//   * every item's workDate must fall inside an active
//     EmployeeAssignment of the employee AND inside the header
//     period,
//   * hours are computed by the handlers (regular + overtime using
//     the same 8h standard day the attendance/overtime modules use),
//   * status changes only through the bound lifecycle actions.
//
// Once approved, the sheet is consumed by the Payroll module
// (see srv/timesheet/handlers/timesheet-payroll.js) and frozen.
// ============================================================

entity Timesheet : managed {
    key ID : UUID;

    // Human-readable identifier, e.g.  TS000123 (@assert.unique).
    timesheetCode : String(20) @assert.unique;

    employee : Association to Employee not null;

    // Reporting period of this sheet.
    periodFromDate : Date not null;
    periodToDate   : Date not null;

    // Denormalized current reporting manager of the employee,
    // refreshed from the active EmployeeAssignment at submit time.
    // Used for row-level READ security and manager scope checks -
    // the same pattern the Performance module uses.
    assignedManager : Association to Employee;

    // Totals recomputed from the items on every save/submit.
    regularHours  : Decimal(6, 2) default 0;
    overtimeHours : Decimal(6, 2) default 0;

    // Lifecycle (see enums.TimesheetStatus).
    status : enums.TimesheetStatus default 'Draft';

    submittedOn : Timestamp;
    reviewedBy  : Association to Employee;
    reviewedOn  : Timestamp;
    reviewerComments : String(500);

    // ------------------------------------------------------------
    // PAYROLL CONSUMPTION (set-once)
    // ------------------------------------------------------------
    // Filled by the Payroll engine (ProcessPayroll) the moment this
    // approved sheet's hours were taken into account for a payroll
    // period. A sheet can be consumed at most once (validated and
    // idempotent in timesheet-payroll.js); a consumed sheet is
    // frozen against direct writes.
    payrollConsumedOn : Timestamp;
    payrollPeriod : Association to PayrollPeriod;

    items : Composition of many TimesheetItem on items.timesheet = $self;
}

// One recorded work entry: one day (+ project) inside the sheet.
entity TimesheetItem : managed {
    key ID : UUID;

    timesheet : Association to Timesheet not null;

    workDate : Date not null;

    // The employment assignment this work belongs to. Validated to
    // cover workDate (fromDate <= workDate <= toDate/null) and to
    // belong to the sheet's employee.
    employeeAssignment : Association to EmployeeAssignment;

    // Optional work references. When a shift is given and no
    // times are entered, the shift template supplies start/end
    // (overnight shifts automatically cross midnight).
    shift   : Association to Shift;
    project : Association to Project;

    startTime : Time;
    endTime   : Time;   // < startTime  =>  overnight (computed +1 day)

    breakHours : Decimal(5, 2) default 0;

    // Computed by the handler on save:
    //   worked minutes = (endTime - startTime [+24h]) - break
    //   regular  = min(worked, 8h standard day)
    //   overtime = max(0, worked - 8h standard day)
    regularHours  : Decimal(5, 2) default 0;
    overtimeHours : Decimal(5, 2) default 0;

    notes : String(500);
}

// ============================================================
// APPEND-ONLY APPROVAL / CORRECTION LEDGER
// ------------------------------------------------------------
// Every lifecycle action writes exactly one row. Rows are never
// updated or deleted by the application (guards in handlers)-
// this is the reviewer trail for corrections after approval.
// ============================================================
entity TimesheetHistory : managed {
    key ID : UUID;

    timesheet : Association to Timesheet not null;

    action       : enums.TimesheetAction not null;
    previousStatus : enums.TimesheetStatus;
    newStatus      : enums.TimesheetStatus not null;

    actor   : Association to Employee not null;
    actedOn : Timestamp not null;
    comments : String(500);
}
