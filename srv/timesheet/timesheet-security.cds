using TimesheetService from './timesheet-service';

// ============================================================
// SPRINT 15 - TIMESHEET SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// No new security framework - the same role set and the same
// row-level where-clause pattern the Performance module uses.
//
//  * HR (HRExecutive / HRAdmin / SystemAdmin) has full access.
//  * An Employee reads and maintains only their OWN timesheets
//    (row-level where clauses) - colleagues' sheets stay invisible.
//    NOTE: a where-clause cannot filter CREATE requests, so the
//    self-write guard in the handlers additionally enforces that a
//    plain employee can only POST sheets for themselves.
//  * A manager (DepartmentManager / ProjectManager) reads the
//    timesheets where they are the recorded assignedManager (the
//    employees whose active assignment reports to them) and may
//    perform the review actions on exactly those rows. Managers are
//    NOT allowed to write employee data on their reports' behalf.
//  * Reopen (correction after approval) is deliberately HR-only -
//    managers must not silently reopen approved work records.
//  * The history ledger is read-only for everybody; only the
//    lifecycle handlers write history rows (directly at db level).
//  * TimesheetItems are contained work records: same visibility as
//    their header (via the timesheet association path).
// ============================================================

annotate TimesheetService with @(requires: 'authenticated-user');

annotate TimesheetService.Timesheets with @restrict: [
    // HR sees everything.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The employee sees their own timesheets; an assigned manager
    // sees the ones assigned to their reporting line - both
    // row-level restricted.
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager'],
      where: 'assignedManager_ID = $user.employeeId' },

    // Maintenance is self-service (own sheets) or HR work.
    { grant: ['CREATE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE'], to: ['Employee'] },
    { grant: ['UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['UPDATE', 'DELETE'], to: ['Employee'],
      where: 'employee_ID = $user.employeeId' },

    // Employee self-service lifecycle actions on their own sheets.
    { grant: ['Submit', 'Withdraw', 'Cancel'], to: ['Employee'],
      where: 'employee_ID = $user.employeeId' },
    // HR may run the full lifecycle for any sheet.
    { grant: ['Submit', 'StartReview', 'Approve', 'Reject', 'Withdraw',
              'Cancel', 'Reopen', 'StartWorkflow'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Reviewer work: in-scope managers only (where = their
    // reporting line). Reopen is intentionally NOT here.
    { grant: ['StartReview', 'Approve', 'Reject'],
      to: ['DepartmentManager', 'ProjectManager'],
      where: 'assignedManager_ID = $user.employeeId' },
    // The workflow-engine integration is started by the sheet owner.
    { grant: ['StartWorkflow'], to: ['Employee'],
      where: 'employee_ID = $user.employeeId' },
];

annotate TimesheetService.TimesheetItems with @restrict: [
    // Same visibility as the containing sheet: HR all, employee own,
    // assigned manager their reports' sheets.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee'],
      where: 'timesheet.employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager'],
      where: 'timesheet.assignedManager_ID = $user.employeeId' },

    // Item maintenance follows the header: the owner edits while in
    // Draft (draft-state guard lives in the handlers), HR always.
    { grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['Employee'],
      where: 'timesheet.employee_ID = $user.employeeId' },
];

annotate TimesheetService.TimesheetHistories with @restrict: [
    // Read-only ledger: same visibility as the sheet.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee'],
      where: 'timesheet.employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager'],
      where: 'timesheet.assignedManager_ID = $user.employeeId' },
];
