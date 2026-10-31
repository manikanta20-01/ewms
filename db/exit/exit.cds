namespace ewms.db.exit;

using { managed } from '@sap/cds/common';

using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.employee.EmployeeAssignment } from '../employee/employee-assignment';

// ============================================================
// SPRINT 21 - EXIT MANAGEMENT
// ------------------------------------------------------------
// Backend-only module built ENTIRELY on existing models - the
// cases reuse Employee (person), EmployeeAssignment (the active
// employment row that resolves the reporting manager), the Sprint
// 10 generic workflow engine (approvals), the Sprint 14 asset
// ledger (clearance evidence), the Sprint 17 document store
// (exit documents) and the shared audit/notification helpers.
//
// NO new employee master data, NO second approval framework, NO
// new file storage, NO duplicated asset inventory.
//
// The four tables, in beginner terms:
//
//   * ExitCase             - the separation case itself (who is
//      leaving, which exit type, the working dates, the notice
//      snapshot, the HR owner and processing indicators).
//      Status moves ONLY via bound actions: nobody has
//      UPDATE/DELETE grants, so a direct PATCH can never flip a
//      status or rewrite a completed case.
//   * ExitChecklistItem    - one line of the clearance checklist.
//      Seeded (never invented) from the ACTIVE
//      ExitClearanceTemplate when clearance starts. Each item
//      knows its domain (Asset / Document / HR / ...) and its
//      responsible ROLE; completion validates the underlying
//      records instead of trusting the caller.
//   * ExitCaseDocument     - a link (NOT a copy) to an EXISTING
//      Sprint 17 employee Document row. Bytes stay in the
//      document store; this row is the exit reference only.
//   * ExitEvent            - append-only history of every status
//      / date / notice change (workflow history records the
//      approvals; this records the business cross-talk).
//
// Configuration tables (HR-maintained):
//   * ExitClearanceTemplate(+Item) - reusable clearance checklist.
//   * ExitNoticePolicy - per exit type notice-period DAYS. There
//      is NO legal notice period in code: no policy row for an
//      exit type = notice NOT CONFIGURED, and the case records
//      noticePeriodStatus 'NotConfigured' so the gap is visible
//      instead of being silently papered over.
//
// Person-level privacy: an exit case IS the employee's departure,
// so read access is scope `employee_ID = $user.employeeId` for
// the employee class and everything for the HR trio - the same
// isolation mechanism the helpdesk uses. No company/legal-entity
// column is invented (documented decision, mirrors Sprint 20).
// ============================================================

entity ExitCase : managed {
    key ID : UUID;

    // Server-generated business code (EXT0001, EXT0002, ...).
    exitNumber : String(20) not null;

    // The departing employee. Server-verified: plain employees can
    // only create cases for THEMSELVES (except EmployerInitiated,
    // which only HR may create about anyone - see handlers).
    employee : Association to Employee not null;

    // Optional reference to the ACTIVE employment assignment the
    // manager step resolves from. Kept as a reference for late
    // readers; the workflow engine always reads the LIVE active
    // assignment, so this is documentation, not authority.
    assignment : Association to EmployeeAssignment;

    // Resignation / Retirement / ContractCompletion -> self or HR
    // initiated per policy; EmployerInitiated -> HR ONLY.
    exitType : enums.ExitType not null;

    // WHO raised the case (server-stamped from the caller; for
    // EmployerInitiated cases this is the acting HR employee).
    initiator : Association to Employee not null;

    /////////////////////// DATES /////////////////////////////
    // Proposed last working day (the employee's wish).
    proposedFinalWorkingDate : Date;

    // The date the approved case moves to clearance with. Set at
    // workflow approval (defaults to proposed) or earlier by the
    // HR ChangeApprovedDate action. History of changes lives in
    // ExitEvent; nothing is silently overwritten.
    approvedFinalWorkingDate : Date;

    // The ACTUAL separation date, stamped at ReadyForSeparation
    // (defaults to approvedFinalWorkingDate). Completed cases are
    // only ever corrected through the audited Correct action.
    separationDate : Date;

    submittedOn  : Timestamp;
    completedOn  : Timestamp;

    // --------------- NOTICE PERIOD (CONFIGURED, NOT LEGAL) ----------
    // Snapshot of the ExitNoticePolicy row that governed the
    // submission (days; null = no configured policy). The status
    // 'NotConfigured' documents the GAP for HR instead of
    // inventing a rule. A recorded waiver is explicit, attributed
    // and audited - never a silent date tweak.
    noticePeriodDays : Integer;
    noticePeriodStatus : enums.NoticePeriodStatus default 'NotConfigured';
    noticeWaivedBy : Association to Employee;
    noticeWaivedOn : Timestamp;
    noticeWaiverReason : String(500);

    /////////////////////// SENSITIVE REASON //////////////////
    // The reason is the most private field on the case. For
    // EmployerInitiated cases it is MASKED on read for every
    // non-HR reader (after-READ filter), and message text for
    // these cases is kept neutral in notifications.
    reasonCategory : enums.ExitReasonCategory not null;
    reasonText : String(2000) not null;

    /////////////////////// LIFECYCLE /////////////////////////
    status : enums.ExitStatus default 'Draft';

    // Assigned HR owner (set by StartReview by the acting HR
    // employee; resolvable-employee only).
    hrOwner : Association to Employee;

    // Workflow linkage (the approval instance; also recorded for
    // late lookups). The engine keeps its own authoritative rows.
    workflowInstanceId : String(36);

    /// ---------------- PROCESSING OUTCOMES ------------------
    // 'Pending' until a payroll-role user records the outcome WITH
    // EVIDENCE (no evidence = the separate settlement record never
    // lies that dues are settled). Retries are no-ops (409-free).
    payrollStatus : enums.ExitPayrollStatus default 'Pending';

    // Set to 'Completed' ONLY by CompleteExit together with the
    // employment-status change (Employee.status -> Inactive).
    finalProcessingStatus : enums.ExitProcessingStatus default 'Pending';

    // Duplicate-safe creation: the SAME clientRequestId never
    // creates a second case (safe retries). Same pattern as the
    // Sprint 19/20 modules.
    clientRequestId : String(100);

    items : Composition of many ExitChecklistItem
        on items.exitCase = $self;
    documents : Composition of many ExitCaseDocument
        on documents.exitCase = $self;
    events : Composition of many ExitEvent
        on events.exitCase = $self;
}

// ------------------------------------------------------------
// ONE CLEARANCE ITEM (seeded from the active template)
// ------------------------------------------------------------
// Write-free for everyone: rows appear only via StartClearance
// (system seeding) and change only via CompleteItem / SkipItem.
// `itemCode` carries the template's stable code so a re-seeded
// case can never receive the same mandatory line twice.
// ------------------------------------------------------------
entity ExitChecklistItem : managed {
    key ID : UUID;

    exitCase : Association to ExitCase not null;

    itemCode : String(30) not null;
    title    : String(150) not null;

    category : enums.ClearanceCategory not null;

//     CAP role the completion action re-checks (grants are the
//     perimeter; completing an item is someone from THAT domain
//     declaring it clear).
    responsibleRole : enums.ClearanceResponsibleRole not null;

    mandatory : Boolean default true;

    status : enums.ClearanceItemStatus default 'Pending';

    completedBy : Association to Employee;
    completedOn : Timestamp;
    remarks : String(500);
}

// ------------------------------------------------------------
// LINK to an EXISTING Sprint 17 employee document
// ------------------------------------------------------------
// Deliberately NOT an Association projection into Document (the
// document bytes stay behind EmployeeService.Documents with its
// strict Download grants). The handler validates existence,
// ownership (employee of the case) and Active status - this row
// never stores or copies file content.
// ------------------------------------------------------------
entity ExitCaseDocument : managed {
    key ID : UUID;

    exitCase : Association to ExitCase not null;

    // Plain reference by ID, validated in the create handler
    // (document must exist, belong to the case's employee and be
    // Active). The same pattern the helpdesk's attachedDocument_ID
    // uses - reusing storage, never duplicating it.
    document_ID : UUID;

    // 'required' marks the row as something the clearance counts
    // (the Document clearance item refuses completion while a
    // required row is missing); 'optional' rows are informational.
    required : Boolean default true;

    addedBy : Association to Employee;
    addedOn : Timestamp;
}

// ------------------------------------------------------------
// APPEND-ONLY EXIT HISTORY
// ------------------------------------------------------------
// eventType labels (plain String, like HRTicketEvent):
//   Created, Submitted, ReviewStarted, NoticeWaived,
//   FinalDateChanged, Approved, Rejected, Reworked, Resubmitted,
//   Withdrawn, Cancelled, Reconsidered, ClearanceStarted,
//   ItemCompleted, ItemSkipped, ReadyForSeparation, Completed,
//   EmploymentDeactivated, FinalSettlementRecorded, Corrected
// ------------------------------------------------------------
entity ExitEvent : managed {
    key ID : UUID;

    exitCase : Association to ExitCase not null;

    eventType : String(30) not null;
    actor : Association to Employee;
    reason : String(500);
    details : String(500);

    fromStatus : enums.ExitStatus;
    toStatus   : enums.ExitStatus;

    eventOn : Timestamp not null;
}

// ------------------------------------------------------------
// CONFIG - reusable clearance checklist (HR-maintained)
// ------------------------------------------------------------
// Same snapshot idea as the Sprint 12 onboarding checklist and
// the workflow engine's definition/steps: configure once, clone
// into the concrete case. One ACTIVE template at a time.
// ------------------------------------------------------------
entity ExitClearanceTemplate : managed {
    key ID : UUID;

    name : String(100) not null;
    description : String(500);

    isActive : Boolean default true;

    items : Composition of many ExitClearanceTemplateItem
        on items.template = $self;
}

entity ExitClearanceTemplateItem : managed {
    key ID : UUID;

    template : Association to ExitClearanceTemplate not null;

    sequence  : Integer not null;
    itemCode  : String(30) not null;
    title     : String(150) not null;
    category  : enums.ClearanceCategory not null;
    responsibleRole : enums.ClearanceResponsibleRole not null;
    mandatory : Boolean default true;
    description : String(500);
}

// ------------------------------------------------------------
// CONFIG - notice period DAYS per exit type (HR-maintained)
// ------------------------------------------------------------
// THE POLICY GAP HONESTY TABLE: a missing row means "not
// configured", NOT "no notice applies" - the case records
// NotConfigured and the submission keeps working while the gap
// is visible for HR to decide (business decision documented in
// SPRINT-21.md; nothing country- or contract-specific is
// invented here).
// ------------------------------------------------------------
entity ExitNoticePolicy : managed {
    key ID : UUID;

    // Exactly one ACTIVE row per exit type.
    exitType : enums.ExitType not null @assert.unique;

    // null = this exit type needs NO configured notice.
    noticePeriodDays : Integer;

    active : Boolean default true;
}
