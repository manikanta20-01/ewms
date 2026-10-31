namespace ewms.db.recruitment;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.employee.Designation } from '../employee/designation';
using { ewms.db.organization.Department } from '../organization/department';

// ============================================================
// SPRINT 12 - OFFER LETTER + ONBOARDING
// ------------------------------------------------------------
// This model covers the selected part of recruitment:
//
//   Candidate -> Offer -> (workflow approval) -> Sent
//             -> Accepted -> OnboardingCase -> Tasks + Docs
//             -> Employee conversion (via existing Employee Core)
//
// IMPORTANT design decisions:
//   * A candidate is NOT an employee. The Employee entity from
//     Sprint 4/5 stays the ONLY employee master. A candidate only
//     becomes an employee at the ConvertToEmployee step of a
//     completed onboarding case (idempotent - see employee-
//     conversion.js).
//   * The offer stores compensation as OFFER INFORMATION only.
//     Payroll (Sprint 8) remains the only system that processes
//     real salaries - no second payroll engine is created here.
//   * Approvals reuse the Sprint 10 generic workflow engine via
//     the businessObjectType "ewms.db.recruitment.Offer" - no new
//     approval logic is implemented in this module.
// ============================================================

// ------------------------------------------------------------
// CANDIDATE - a person being recruited (not yet an employee)
// ------------------------------------------------------------
entity Candidate : managed {
    key ID : UUID;

    // Auto-generated business code, e.g. CAND0001 (same pattern
    // as COMP0001 / EMP000001 used everywhere in EWMS).
    candidateCode : String(20) @assert.unique;

    firstName : String(100) not null;
    lastName  : String(100);

    // Contact data reused later for the employee record during
    // conversion (email must stay unique there).
    email : type.Email;
    mobile : type.Phone;

    // Where the candidate came from (portal, referral, agency ...).
    source : String(50);

    experienceYears : Decimal(4,1) default 0;

    // New -> Selected -> (offer flow) -> Hired on conversion.
    status : enums.CandidateStatus default 'New';

    notes : type.Description;

    offers : Association to many Offer on offers.candidate = $self;
}

// ------------------------------------------------------------
// OFFER LETTER
// ------------------------------------------------------------
// One offer for one candidate. Lifecycle: Draft -> PendingApproval
// -> Approved -> Sent -> Accepted/Rejected/Expired/Withdrawn.
// The allowed transitions live in offer-lifecycle.js; the status
// enum only defines the vocabulary.
// ------------------------------------------------------------
entity Offer : managed {
    key ID : UUID;

    // Auto-generated reference, e.g. OFF0001.
    offerNumber : String(20) @assert.unique;

    candidate : Association to Candidate not null;

    // Target position data (copied into the employee + assignment
    // on conversion).
    department : Association to Department;
    designation : Association to Designation;
    reportingManager : Association to Employee;

    employmentType : enums.EmploymentType default 'Permanent';

    // Dates: expiry must be after offerDate (validated in the
    // lifecycle handler); an expired offer can never be accepted.
    offerDate  : Date;
    expiryDate : Date;
    joiningDate : Date;

    // ---------------------------------------------------------
    // OFFER COMPENSATION (SENSITIVE)
    // ---------------------------------------------------------
    // This is purely offer information shown on the letter.
    // It is NOT connected to payroll processing. Access is
    // protected in recruitment-security.cds and broad queries
    // mask this field for roles without compensation visibility
    // (see handlers/offer-lifecycle.js -> maskCompensation).
    offeredCTC : type.Amount;
    currency : enums.CurrencyType default 'INR';

    // Working conditions for the letter text.
    probationMonths : Integer default 6;
    workLocation : String(100);
    benefitsNote : String(500);

    // Free terms/notes that later flow into the letter document
    // (document GENERATION itself is Sprint 17 territory).
    terms : String(1000);
    notes : type.Description;

    // Lifecycle bookkeeping.
    status : enums.OfferStatus default 'Draft';
    sentOn : Timestamp;
    acceptedOn : Timestamp;

    // Set once the candidate accepted - used to make acceptance
    // idempotent and to link the auto-created onboarding case.
    onboardingCase : Association to many OnboardingCase on onboardingCase.offer = $self;
}

// ------------------------------------------------------------
// ONBOARDING CHECKLIST (REUSABLE TEMPLATE)
// ------------------------------------------------------------
// A named checklist (e.g. STANDARD_EMPLOYEE_ONBOARDING) with an
// ordered list of task items. When an offer is accepted, the
// active checklist is copied into concrete OnboardingTasks of the
// new onboarding case - same "template snapshot" idea the
// workflow engine uses with definitions/steps.
// ------------------------------------------------------------
entity OnboardingChecklist : managed {
    key ID : UUID;

    checklistCode : String(20) @assert.unique;
    name : type.Name100 not null;
    description : type.Description;

    // Only active checklists are used when seeding tasks.
    isActive : Boolean default true;

    items : Composition of many OnboardingChecklistItem on items.checklist = $self;
}

entity OnboardingChecklistItem : managed {
    key ID : UUID;

    checklist : Association to OnboardingChecklist not null;

    // Execution order inside the checklist (1, 2, 3 ...).
    sequence : Integer not null;

    // Stable technical key, e.g. VERIFY_IDENTITY - lets tests and
    // future automation find a task without knowing its UUID.
    taskCode : String(20) not null;

    title : type.Name100 not null;
    description : type.Description;

    // Mandatory tasks must be completed before the case can be
    // completed and converted into an employee.
    mandatory : Boolean default true;

    // HR role that normally performs this task (informational -
    // the concrete assignee is set per case/task).
    assigneeRole : String(50);
}

// ------------------------------------------------------------
// ONBOARDING CASE
// ------------------------------------------------------------
// Created automatically when a candidate accepts an offer (or
// manually by HR for an already-accepted offer). Carries the
// target org data and tracks completion + employee conversion.
// ------------------------------------------------------------
entity OnboardingCase : managed {
    key ID : UUID;

    // Auto-generated reference, e.g. ONB0001.
    onboardingNumber : String(20) @assert.unique;

    candidate : Association to Candidate not null;
    offer : Association to Offer not null;

    // Target org data (defaults come from the accepted offer and
    // can be corrected by HR before conversion).
    plannedJoiningDate : Date;
    department : Association to Department;
    designation : Association to Designation;
    reportingManager : Association to Employee;

    // The HR user who drives the onboarding.
    coordinator : Association to Employee;

    // NotStarted -> InProgress -> (OnHold <-> InProgress) -> Completed
    // Cancelled is possible from all non-final states.
    status : enums.OnboardingStatus default 'NotStarted';

    // Progress in percent (0-100), recalculated by the handlers
    // whenever a task changes: done-or-skipped tasks / total tasks.
    // Stored (not computed on the fly) so lists show progress with
    // ONE query instead of loading every task of every case.
    progress : Integer default 0;

    startedAt : Timestamp;
    completedAt : Timestamp;

    // ---------------------------------------------------------
    // IDEMPOTENCY MARKER for employee conversion:
    // once set, this case has ALREADY created its employee and
    // ConvertToEmployee will never create a second one. This is
    // the single source of truth for "already converted".
    // ---------------------------------------------------------
    // The converted employee is exposed as a REAL association; its
    // foreign key column is convertedEmployee_ID, which is also
    // what the handlers read/write (see employee-conversion.js).
    // Exposing it as an association lets OData clients follow
    // OnboardingCases -> convertedEmployee with $expand, while the
    // plain convertedEmployee_ID column remains the idempotency
    // marker inside the handlers.
    convertedEmployee : Association to Employee;

    notes : type.Description;

    tasks : Association to many OnboardingTask on tasks.onboardingCase = $self;
    documentRequirements : Association to many OnboardingDocumentRequirement
        on documentRequirements.onboardingCase = $self;
}

// ------------------------------------------------------------
// ONBOARDING TASK - one reusable task row inside one case
// ------------------------------------------------------------
// Every task type (identity check, access setup, orientation...)
// is a ROW here, not a separate entity/table. The taskCode makes
// tasks findable programmatically.
// ------------------------------------------------------------
entity OnboardingTask : managed {
    key ID : UUID;

    onboardingCase : Association to OnboardingCase not null;

    taskCode : String(20);
    title : type.Name100 not null;
    description : type.Description;

    // Who has to do it (an employee) and/or which role queue.
    assignee : Association to Employee;
    assigneeRole : String(50);

    dueDate : Date;
    sequence : Integer;

    mandatory : Boolean default true;

    // Pending -> InProgress -> Completed; Skipped/Blocked are
    // side exits (transitions validated in onboarding-lifecycle.js).
    status : enums.OnboardingTaskStatus default 'Pending';

    completedAt : Timestamp;
    completedBy : Association to Employee;

    notes : type.Description;
}

// ------------------------------------------------------------
// ONBOARDING DOCUMENT REQUIREMENT
// ------------------------------------------------------------
// Tracks WHICH documents must be collected for onboarding and
// their collection status. Real upload/verification workflows
// arrive with Sprint 17 (Documents + Compliance); the
// documentType string + status here are the clean extension
// point for that sprint - no duplicate document tables.
// ------------------------------------------------------------
entity OnboardingDocumentRequirement : managed {
    key ID : UUID;

    onboardingCase : Association to OnboardingCase not null;

    // Standard types: IDENTITY, ADDRESS, EDUCATION, EXPERIENCE,
    // SIGNED_OFFER, TAX (constants in onboarding-lifecycle.js).
    documentType : String(50) not null;

    title : type.Name100;
    mandatory : Boolean default true;

    // Required -> Submitted -> Verified/Rejected; Waived is the
    // explicit HR exemption.
    status : enums.OnboardingDocStatus default 'Required';

    submittedOn : Timestamp;
    verifiedOn : Timestamp;
    verifiedBy : Association to Employee;

    notes : type.Description;
}
