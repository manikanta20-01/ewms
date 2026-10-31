using { ewms.db.hr_policy as db } from '../../db/schema';

// ============================================================
// SPRINT 19 - HR POLICY MANAGEMENT (SERVICE)
// ------------------------------------------------------------
// One service, four concerns - all backend-only and built on
// the EXISTING Employee/Organization models:
//
//   1. Policies      - the stable identity (code/title/owner/
//                      applicability). CRUD is HR work; direct
//                      nested creation of versions is refused
//                      (versions come from CreateVersion only).
//
//   2. PolicyVersions- one rev per row with its OWN lifecycle:
//                      Draft -> InReview -> Approved ->
//                      Published -> Superseded (by the next
//                      publish) / Withdrawn -> Archived.
//                      All transitions are bound ACTIONS;
//                      PATCH never moves a status and can never
//                      overwrite published content.
//
//   3. Acknowledge   - bound on PolicyVersions. Employees
//                      acknowledge the PUBLISHED version that
//                      applies to them; duplicates are safe
//                      (same record returned, never a second
//                      row); records are immutable.
//
//   4. OutstandingAcknowledgments - COMPUTED view (skip
//                      entity, recomputed on every read) with
//                      HR-only reporting, plus the manual
//                      SendPolicyReminders trigger with dedupe.
// ============================================================

service HRPolicyService @(requires: 'authenticated-user') {

    entity Policies as projection on db.Policy actions {

        // Create the NEXT version of a policy. Refuses while a
        // Draft/InReview version is pending; copies forward from
        // the latest version; honors clientRequestId so a retry
        // never creates a duplicate draft.
        action CreateVersion(content : String(10000),
                             contentReference : String(500),
                             effectiveDate : Date,
                             expiryDate : Date,
                             reviewDate : Date,
                             clientRequestId : String(100)) returns String;
    };

    entity PolicyVersions as projection on db.PolicyVersion actions {

        // Draft -> InReview (owner or HR).
        action SubmitForReview() returns String;

        // InReview -> Approved (approver, NOT the submitter).
        action Approve(comments : String(500)) returns String;

        // InReview -> Draft again (reason required).
        action Reject(comments : String(500)) returns String;

        // Approved -> Published. Automatically supersedes the
        // previously published version (status change only - its
        // acknowledgment records are NEVER touched).
        action Publish() returns String;

        // Published -> Withdrawn (reason required); employees
        // immediately lose visibility of the version.
        action Withdraw(reason : String(500)) returns String;

        // Withdrawn -> Archived.
        action Archive() returns String;

        // Employee acknowledgment of THIS version (self-only,
        // published + effective + applicable, duplicate-safe).
        action Acknowledge(statement : String(1000)) returns String;
    };

    // Immutable acknowledgment records: own rows for employees,
    // full read for the HR trio (see policy-security.cds).
    entity PolicyAcknowledgments as projection on db.PolicyAcknowledgment;

    // Computed, NOT persisted (custom READ handler): for every
    // policy with a PUBLISHED + EFFECTIVE + acknowledged-requiring
    // version, the employees the policy applies to who have NOT
    // acknowledged THAT version yet. HR-only (same line-of-sight
    // rule as Sprint 17 compliance reporting).
    entity OutstandingAcknowledgments @(cds.persistence.skip) {
        key policy_ID      : UUID;
        key employee_ID    : UUID;
        policyCode      : String(20);
        policyTitle     : String(150);
        category        : String(30);
        policyVersion_ID: UUID;
        versionNo       : Integer;
        effectiveDate   : Date;
        reviewDate      : Date;
        employeeCode    : String(20);
        firstName       : String(100);
        lastName        : String(100);
        employmentType  : String(20);
    };

    // Manual reminder trigger (dedupe-safe like Sprint 17):
    //   1. outstanding acknowledgment reminders (per employee x
    //      version, one notification ever),
    //   2. upcoming reviewDate reminders to the policy owner.
    // Safe to re-call from a cron job / BTP job task.
    action SendPolicyReminders(daysBefore : Integer) returns String;
}
