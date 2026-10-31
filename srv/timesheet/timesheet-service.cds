using { ewms.db.timesheet as db } from '../../db/schema';

// ============================================================
// SPRINT 15 - TIMESHEET SERVICE
// ------------------------------------------------------------
// Exposes the timesheet lifecycle:
//
//   Draft -> Submitted -> InReview -> Approved
//   side exits: Reject -> (back to Draft), Withdraw, Cancel,
//   Reopen (HR-controlled correction path, blocked once payroll
//   consumed the sheet).
//
// Standard OData V4 CRUD covers create/read/update; every STATE
// change goes through a dedicated bound action (guard pattern from
// Sprint 13) so a direct PATCH can never bypass the transition
// rules. Approval reuses the Sprint 10 generic workflow engine
// through the optional StartWorkflow action.
//
// Security lives in timesheet-security.cds (existing Sprint 9
// roles only, row-level where clauses).
// ============================================================

service TimesheetService @(requires: 'authenticated-user') {

    entity Timesheets as projection on db.Timesheet actions {
        // Draft -> Submitted (employee self-service; refreshes the
        // reporting manager, computes totals, notifies the manager).
        action Submit() returns String;

        // Submitted -> InReview (reviewer opens the review).
        action StartReview() returns String;

        // InReview -> Approved. The DEFINED review steps may not be
        // self-approved; only the reporting manager inside scope (or
        // HR/SystemAdmin as documented fallback) may approve.
        action Approve(comments : String(500)) returns String;

        // Submitted/InReview -> Draft. Reason is mandatory; the
        // sheet becomes editable for the employee again.
        action Reject(comments : String(500)) returns String;

        // Submitted/InReview -> Draft (employee withdrawal).
        action Withdraw() returns String;

        // Draft/Submitted/InReview -> Cancelled (final, not payroll
        // countable). Owner or HR.
        action Cancel(comments : String(500)) returns String;

        // Approved -> Draft. HR/SystemAdmin controlled correction
        // path; refused once payroll consumed the sheet.
        action Reopen() returns String;

        // Opt-in multi-step approval via the Sprint 10 generic
        // workflow engine (definition WF-TIMESHEET-STD). Task
        // decisions sync the private status through callbacks.
        action StartWorkflow() returns String;
    };

    entity TimesheetItems as projection on db.TimesheetItem;

    // Audit trail of transitions; append-only (write guards in the
    // service implementation reject direct UPDATE/DELETE/CREATE).
    entity TimesheetHistories as projection on db.TimesheetHistory;
}
