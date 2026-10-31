using { ewms.db.recruitment as db } from '../../db/schema';

// ============================================================
// SPRINT 12 - OFFER LETTER + ONBOARDING (SERVICE)
// ------------------------------------------------------------
// Exposes the recruitment lifecycle:
//
//   Candidates -> Offers (lifecycle actions) -> Workflow approval
//   -> Send -> Accept -> OnboardingCase (auto-created)
//   -> Tasks + Document requirements -> Complete
//   -> ConvertToEmployee (reuses the existing Employee Core)
//
// Standard OData CRUD covers create/read/update; every STATE
// change goes through a dedicated action so that the lifecycle
// rules in the handlers are always enforced. Security lives in
// recruitment-security.cds (Sprint 9 roles only).
// ============================================================

service RecruitmentService @(requires: 'authenticated-user') {

    // ---------------------------------------------------------
    // CANDIDATES (not employees - see db/recruitment/recruitment.cds)
    // ---------------------------------------------------------
    entity Candidates as projection on db.Candidate;

    // ---------------------------------------------------------
    // OFFER LETTERS with the full lifecycle as bound actions.
    // Each action validates current status + business rules in
    // handlers/offer-lifecycle.js.
    // ---------------------------------------------------------
    entity Offers as projection on db.Offer actions {
        // Draft -> PendingApproval. Auto-starts the generic
        // workflow (Sprint 10 engine) when an active definition
        // exists for offers; otherwise direct approval applies.
        action SubmitForApproval() returns String;

        // Direct approval fallback (HR). Blocked while a workflow
        // instance is running for this offer.
        action ApproveOffer(comments : String(500)) returns String;

        // Approver rejects the offer (back to HR).
        action RejectOffer(comments : String(500)) returns String;

        // Approved -> Sent to the candidate.
        action SendOffer() returns String;

        // Candidate ACCEPTED (recorded by HR): locks the offer and
        // auto-creates the OnboardingCase + standard tasks/docs.
        action RecordAcceptance() returns String;

        // Candidate DECLINED the offer.
        action RecordRejection(comments : String(500)) returns String;

        // HR withdraws a not-yet-accepted offer.
        action WithdrawOffer(comments : String(500)) returns String;

        // Mark an unanswered offer as expired (admin/housekeeping).
        action ExpireOffer() returns String;
    };

    // ---------------------------------------------------------
    // ONBOARDING CHECKLIST (reusable template for standard tasks)
    // ---------------------------------------------------------
    entity OnboardingChecklists as projection on db.OnboardingChecklist;
    entity OnboardingChecklistItems as projection on db.OnboardingChecklistItem;

    // ---------------------------------------------------------
    // ONBOARDING CASES - created automatically on acceptance.
    // ---------------------------------------------------------
    entity OnboardingCases as projection on db.OnboardingCase actions {
        action StartOnboarding() returns String;
        action HoldOnboarding(comments : String(500)) returns String;
        action ResumeOnboarding() returns String;
        // Completes the case; blocks while mandatory tasks/docs
        // are open (see handlers/onboarding-lifecycle.js).
        action CompleteOnboarding() returns String;
        action CancelOnboarding(comments : String(500)) returns String;

        // THE critical step: creates the employee through the
        // EXISTING Employee Core. Idempotent - calling it twice
        // never creates two employees.
        action ConvertToEmployee() returns String;
    };

    // ---------------------------------------------------------
    // ONBOARDING TASKS (one reusable task model for every task
    // type - no per-task entities).
    // ---------------------------------------------------------
    entity OnboardingTasks as projection on db.OnboardingTask actions {
        action StartTask() returns String;
        action CompleteTask(comments : String(500)) returns String;
        action SkipTask(comments : String(500)) returns String;
        action BlockTask(comments : String(500)) returns String;
        action ReopenTask() returns String;
    };

    // ---------------------------------------------------------
    // DOCUMENT REQUIREMENTS - collection tracking only; real
    // document management arrives with Sprint 17.
    // ---------------------------------------------------------
    entity OnboardingDocumentRequirements as projection on db.OnboardingDocumentRequirement actions {
        action SubmitDocument(notes : String(500)) returns String;
        // Verification is HR-executive work (restricted in
        // recruitment-security.cds).
        action VerifyDocument(notes : String(500)) returns String;
        action RejectDocument(notes : String(500)) returns String;
        action WaiveDocument(notes : String(500)) returns String;
    };
}
