using { ewms.db.exit as db } from '../../db/schema';

// ============================================================
// SPRINT 21 - EXIT MANAGEMENT (SERVICE)
// ------------------------------------------------------------
// One service, backend-only; every reference reuses an EXISTING
// module surface (no duplication anywhere):
//
//   ExitCases        - create/view own cases; WHOLE lifecycle
//                      through bound actions ONLY (nobody has
//                      UPDATE/DELETE grants, so a direct PATCH can
//                      never move a status or rewrite a completed
//                      case). Approvals ride the Sprint 10 generic
//                      workflow engine (Manager -> HR steps);
//                      exit handlers never implement their own
//                      approval logic.
//   ExitChecklistItems  - seeded automatically when clearance
//                      starts; completed only via the bound
//                      CompleteItem / SkipItem actions, which
//                      VERIFY the underlying record (asset ledger,
//                      linked documents) before agreeing.
//   ExitCaseDocuments   - links to existing Sprint 17 documents.
//                      The document bytes stay behind their own
//                      authorized surface; this is a reference.
//   ExitEvents          - append-only history (HR-only read).
//   DepartingEmployeeAssets - COMPUTED at read time from the
//                      Sprint 14 asset ledger: which assets is the
//                      departing employee still holding. Read-only
//                      evidence for the Asset clearance item.
//   ExitClearanceTemplates / Items - reusable checklist config.
//   ExitNoticePolicies  - the honest configuration table: a
//                      missing row = NOT CONFIGURED, surfaced as
//                      noticePeriodStatus 'NotConfigured' on the
//                      case, never silently treated as "no notice".
// ============================================================

service ExitService @(requires: 'authenticated-user') {

    entity ExitCases as projection on db.ExitCase actions {

        // Owner (or HR) moves Draft -> Submitted. Validates the
        // final working date against the CONFIGURED notice policy
        // (short dates are refused until an HR waiver is recorded)
        // and starts the generic workflow instance (Manager and
        // then HR approvers, self-approval always forbidden).
        action Submit() returns String;

        // Requester or HR before approval: Draft/Submitted/InReview
        // -> Withdrawn (cancels the running workflow instance).
        action Withdraw(reason : String(500)) returns String;

        // HR: Submitted -> InReview; stamps the acting HR employee
        // as the case owner (must be a resolvable employee).
        action StartReview() returns String;

        // HR: records an authorized notice waiver BEFORE the short
        // date can be submitted. Explicit + audited, never silent.
        action WaiveNotice(reason : String(500)) returns String;

        // HR: changes the final working date pre-approval with a
        // mandatory reason (history keeps every change).
        action ChangeApprovedDate(finalWorkingDate : Date, reason : String(500)) returns String;

        // HR: Approved -> ClearanceInProgress. Seeds the concrete
        // checklist items from the ACTIVE template (idempotent).
        action StartClearance() returns String;

        // HR: ClearanceInProgress -> ReadyForSeparation. Refused
        // while ANY mandatory checklist item is still open, so
        // required clearance can never be silently bypassed.
        action MarkReadyForSeparation() returns String;

        // HR: ReadyForSeparation -> Completed. Also the ONLY place
        // the employment status flips (Employee.status ->
        // Inactive + relievingDate). An HR contact in DepartmentHR
        // cannot be deactivated by generic automation: that case
        // needs SystemAdmin (documented guard).
        action CompleteExit() returns String;

        // HRAdmin/SystemAdmin: the authorized, auditable correction
        // path for COMPLETED cases (separationDate with mandatory
        // reason). Direct PATCHes are impossible (no grants).
        action Correct(separationDate : Date, reason : String(500)) returns String;

        // Payroll/Finance/HR: records the exit-payroll outcome
        // WITH EVIDENCE (an existing processed/approved payroll
        // process row covering the separation month). Without
        // evidence this refuses - the module never claims dues are
        // settled just because the case says so. Retry = no-op.
        action RecordFinalSettlement(remarks : String(500)) returns String;

        // HR: Rejected -> Draft (audited reconsideration; the next
        // Submit starts a FRESH workflow instance - the rejected
        // one stays final and immutable).
        action Reconsider(reason : String(500)) returns String;
    };

    entity ExitChecklistItems as projection on db.ExitChecklistItem actions {
        // Complete one item. CATEGORY-KEYED verification:
        //   Asset    -> requires ZERO active asset assignments
        //   Document -> requires >= 1 linked required document
        // and ROLE verification (the caller must hold the item's
        // responsibleRole / be the reporting manager). Retried
        // calls on a completed item are friendly no-ops.
        action CompleteItem(remarks : String(500)) returns String;

        // HRAdmin/SystemAdmin only: mark an OPTIONAL item as
        // NotApplicable with a reason (mandatory items refuse).
        action SkipItem(reason : String(500)) returns String;
    };

    entity ExitCaseDocuments as projection on db.ExitCaseDocument;

    // Append-only history. HR-only: internal routing and reason
    // details are not requester data (same rule as helpdesk
    // events); the requester follows the case via its own fields.
    entity ExitEvents as projection on db.ExitEvent;

    // Configuration surfaces (HR trio CRUD).
    entity ExitClearanceTemplates as projection on db.ExitClearanceTemplate;
    entity ExitClearanceTemplateItems as projection on db.ExitClearanceTemplateItem;
    entity ExitNoticePolicies as projection on db.ExitNoticePolicy;

    // COMPUTED at read time (never stale) from the Sprint 14
    // asset ledger: the assets the case's employee still holds
    // (active AssetAssignment rows). HR-only - asset custody is
    // not requester data. Filter with `case_ID` (required).
    entity DepartingEmployeeAssets @(cds.persistence.skip) {
        key case_ID      : UUID;
        key asset_ID     : UUID;
        assetTag         : String(30);
        assetName        : String(100);
        status           : String(20);
        assignedOn       : Date;    // assignment startDate
        returnedOn       : Date;    // assignment close date (null = still held)
        condition        : String(20);
    }
}
