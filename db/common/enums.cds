namespace ewms.db.common;

// common status
type Status : String enum {
    Active;
    Inactive;
    Closed;
    Pending;
}

// Gender
type Gender : String enum {
    Male;
    Female;
}

// Marital Status
type MaritalStatus : String enum {
    Married;
    Single;
    Divorced;
    Widowed;
}

// Employee-Type
type EmploymentType : String enum {
    Permanent;
    Contract;
    Intern;
    Trainee;
    Consultant;
}

// Project Status
type ProjectStatus : String enum {
    Planning;
    Active;    
    Hold;
    Completed;
    Cancelled;
}

// Attendance Status
type AttendanceStatus : String enum {
    Present;
    Absent;
    HalfDay;
    Leave;
    Holiday;
    WeekOff;
    WorkFromHome;
    OnDuty;
}

// Where the employee checked in from
type WorkLocation : String enum {
    Office;
    WorkFromHome;
}

type LeaveType : String enum {
    Casual;
    Sick;
    Earned;
    Maternity;
    Paternity;
    CompOff;
    LOP;
}


/*
 * Leave Status
 */

type LeaveStatus : String enum {
    Draft;
    Pending;
    TeamApproved;
    ProjectApproved;
    HRApproved;
    Rejected;
    Cancelled;
}

type ApprovalDecision : String enum {
    Pending;
    Approved;
    Rejected;
}
type HalfDayType : String enum {
    FirstHalf;
    SecondHalf;
}
/*
 * Payroll Status
 */

type PayrollStatus : String enum {
    Draft;
    Processed;
    Paid;
}

type SalaryComponentType : String enum {
    Earning;
    Deduction;
}

// Calculation Type
type CalculationType : String enum {
    Fixed;
    Percentage;
    Formula;
}

// Payroll Action Types
type PayrollAction : String enum {
    Created;
    Processed;
    Approved;
    Published;
    Cancelled;
    Reprocessed;
}

// Payroll Process Status
type ProcessStatus : String enum {
    Pending;
    Processed;
    Approved;
    Rejected;
    Published;
}

/*
 * Asset Status
 * ------------------------------------------------------------
 * Sprint 14 EXTENDED this pre-existing enum (it previously had
 * Available/Assigned/Returned/Lost/Damaged and was not yet used
 * by any entity). New values follow the asset lifecycle enforced
 * in srv/asset/handlers/asset-lifecycle.js:
 *
 *   Available -> Assigned -> (Returned via assignment close)
 *   side exits: InRepair, Lost, Damaged, Retired, Disposed
 */
type AssetStatus : String enum {
    Available;
    Assigned;
    Returned;   // legacy value, kept for compatibility
    InRepair;
    Lost;
    Damaged;
    Retired;
    Disposed;
}

/*
 * Physical condition of an asset. Recorded at assignment, return,
 * inspection and repair completion so the history shows how the
 * asset aged (Sprint 21 Exit Management reads the return condition).
 */
type AssetCondition : String enum {
    New;
    Good;
    Fair;
    Damaged;
    Critical;
}

/*
 * Lifecycle of one asset-to-employee assignment. 'Returned' is a
 * CLOSED assignment (returned or transferred away) - the row is
 * never deleted, it IS the history.
 */
type AssetAssignmentStatus : String enum {
    Active;
    Returned;
    Cancelled;
}

/*
 * Result of an asset inspection. 'Reusable'/'RepairRequired' move
 * the asset status directly; 'RetireRecommended'/'DisposeRecommended'
 * route the asset to the dedicated retire/dispose actions.
 */
type AssetInspectionOutcome : String enum {
    Reusable;
    RepairRequired;
    RetireRecommended;
    DisposeRecommended;
}


/*
 * Interview Status
 */

type InterviewStatus : String enum {
    Scheduled;
    Completed;
    Selected;
    Rejected;
}

// ---------Currency-------
type CurrencyType : String enum {
    INR;
    USD;
    EUR;
}

type DocumentType : String enum {
    Aadhar;
    PAN;
    Passport;
    Resume;
    Degree;
    AllTypes;

    // Sprint 17 additions (compliance requirements pick from the
    // SAME vocabulary as employee documents - one catalog only).
    EmploymentContract;
    AddressProof;
    MedicalCertificate;
    BackgroundCheck;
}

type BloodGroup : String enum {
    A_Positive;
    A_Negative;
    B_Positive;
    B_Negative;
    AB_Positive;
    AB_Negative;
    O_Positive;
    O_Negative;
}

type AccountType : String enum {
    Savings;
    Current;
    Salary;
}

type QualificationType : String enum {
    SSC;
    HSC;
    Diploma;
    Bachelor;
    Master;
    Doctorate;
    Certification;
}

type WorkMode : String enum {
    Office;
    WFH;
    Onsite;
}

type HolidayType : String enum {
    National;
    Festival;
    Regional;
    Company;
}

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW AND APPROVAL ENGINE
// -----------------------------------------------------------
// These enums are shared by the generic workflow entities and
// by every business module that connects the engine (Leave,
// Payroll, Timesheet, ...). Keeping them here follows the
// project's convention of centralizing enums in db/common.
// ============================================================

/*
 * Workflow Definition status (is the definition usable or not).
 * Only 'Active' definitions may start new workflow instances;
 * instances already running on an 'Inactive' definition finish
 * their journey normally.
 */
type WorkflowDefinitionStatus : String enum {
    Active;
    Inactive;
}

/*
 * Lifecycle of one running workflow instance.
 * Terminated / Rework are terminal-ish states:
 *  - Terminated : instance was cancelled (e.g. request withdrawn)
 *  - Rework     : task was sent back to the requester, the instance
 *                 pauses at step 1 until the requester resubmits
 */
type WorkflowInstanceStatus : String enum {
    Running;
    Approved;
    Rejected;
    Cancelled;
    Terminated;
    Rework;
}

/*
 * Lifecycle of a single workflow task given to one approver.
 */
type WorkflowTaskStatus : String enum {
    Open;
    Approved;
    Rejected;
    Skipped;    // instance moved on without this task (sendback / cancel)
    Cancelled;  // whole instance was cancelled
}

/*
 * Who an approval step is routed to. 'Manager' resolves through
 * the employee's active EmployeeAssignment.reportingManager;
 * 'LevelHR' resolves through the active DepartmentHR record -
 * the same resolution logic the Leave module already uses.
 */
type StepApproverType : String enum {
    Position;   // specific person (assigneeEmployee_ID set)
    Role;       // first active user having the role (assigneeRole set)
    Manager;    // requester's reporting manager
    LevelHR;    // department's HR representative
}

/*
 * How sibling tasks inside ONE step behave:
 *  - SingleSequential : only one task, forwarded to next step on approve
 *  - AllMustApprove   : parallel step - every sibling must approve
 *  - AnyCanApprove    : parallel step - first approve moves forward,
 *                       remaining siblings become Skipped
 */
type StepApprovalMode : String enum {
    SingleSequential;
    AllMustApprove;
    AnyCanApprove;
}

/*
 * every action/boundary crossing that may occur in the engine.
 */
type WorkflowAction : String enum {
    Submitted;
    Assigned;
    Approved;
    Rejected;
    SendBack;
    Resubmitted;
    Reassigned;
    Delegated;
    Cancelled;
    Escalated;
    Completed;
}

// ============================================================
// SPRINT 11 - NOTIFICATIONS
// ------------------------------------------------------------
// Shared enums for the generic notification module. Business
// modules (Leave, Payroll, Workflow, ...) pass these values when
// they ask the Notification Service to inform a user, so the
// whole application stays consistent from one central place.
// ============================================================

/*
 * WHO the notification is about (which business area raised it).
 * One value per EWMS module + SYSTEM for technical messages.
 * New modules simply add a value here - nothing else changes.
 */
type NotificationCategory : String enum {
    WORKFLOW;
    LEAVE;
    PAYROLL;
    DOCUMENT;
    RECRUITMENT;
    PERFORMANCE;
    ASSET;
    TIMESHEET;
    ATTENDANCE;
    COMPLIANCE;
    POLICY;
    SUPPORT;

    // Sprint 21 - Exit Management rides the SHARED notification
    // core with its own category (one value per module by design).
    EXIT;

    SYSTEM;
}

/*
 * How urgently the recipient should treat the notification.
 * High   : act now (e.g. approval waiting, payroll exception)
 * Medium : normal business message (default)
 * Low    : informational only (e.g. published payslip hint)
 */
type NotificationPriority : String enum {
    High;
    Medium;
    Low;
}

/*
 * Read lifecycle of one notification:
 *   Unread -> Read  (one-way; see srv/notification handlers for
 *   why notifications never go back to Unread).
 */
type NotificationStatus : String enum {
    Unread;
    Read;
}

/*
 * Delivery channels. Only IN_APP is implemented in Sprint 11;
 * EMAIL exists so preferences/templates are already future-proof.
 * Sending real emails is a later sprint (needs SMTP/BTP setup).
 */
type NotificationChannel : String enum {
    IN_APP;
    EMAIL;
}

// ============================================================
// SPRINT 12 - OFFER LETTER & ONBOARDING (RECRUITMENT)
// ------------------------------------------------------------
// Shared enums for the recruitment domain. They follow the same
// central-enum convention as every other module so that offers,
// onboarding cases and future Fiori apps all show consistent
// values.
// ============================================================

/*
 * Journey of one candidate through recruitment.
 * 'Selected' means "may receive an offer"; only 'Hired' means an
 * employee record was actually created during onboarding
 * conversion (see srv/recruitment/handlers/employee-conversion.js).
 */
type CandidateStatus : String enum {
    New;
    Selected;
    Rejected;
    Hired;
    Withdrawn;
}

/*
 * Lifecycle of one offer letter. The allowed transitions are
 * enforced in srv/recruitment/handlers/offer-lifecycle.js -
 * this enum is only the vocabulary.
 */
type OfferStatus : String enum {
    Draft;
    PendingApproval;
    Approved;
    Sent;
    Accepted;
    Rejected;      // approver rejected OR candidate declined (see acceptedOn/notes)
    Expired;
    Withdrawn;
}

/*
 * Lifecycle of one onboarding case. Transitions are enforced in
 * srv/recruitment/handlers/onboarding-lifecycle.js.
 */
type OnboardingStatus : String enum {
    NotStarted;
    InProgress;
    OnHold;
    Completed;
    Cancelled;
}

/*
 * Lifecycle of a single onboarding task inside a case.
 */
type OnboardingTaskStatus : String enum {
    Pending;
    InProgress;
    Completed;
    Skipped;
    Blocked;
}

/*
 * Collection state of one onboarding document requirement.
 * The REAL document management (upload/scan/expiry) comes with
 * Sprint 17 - this status only tracks the onboarding checklist
 * and holds a clean extension point for that sprint.
 */
type OnboardingDocStatus : String enum {
    Required;
    Submitted;
    Verified;
    Rejected;
    Waived;
}

// ============================================================
// SPRINT 13 - PERFORMANCE MANAGEMENT
// ------------------------------------------------------------
// Vocabulary for the performance domain. The ALLOWED status
// transitions are enforced in srv/performance/handlers/* - these
// enums only define the values, exactly like every other module.
// ============================================================

/*
 * Lifecycle of one performance review.
 *   Draft -> PendingReview -> InReview -> Submitted -> Approved
 *   -> Completed, with Cancelled as a side exit from every
 *   non-final state (see review-lifecycle.js).
 */
type PerformanceReviewStatus : String enum {
    Draft;
    PendingReview;
    InReview;
    Submitted;
    Approved;
    Completed;
    Cancelled;
}

/*
 * Lifecycle of one performance goal.
 *   Draft -> Active -> Completed, Cancelled as side exit.
 */
type PerformanceGoalStatus : String enum {
    Draft;
    Active;
    Completed;
    Cancelled;
}

/*
 * Performance rating scale (1-5). A controlled five-level scale
 * keeps overall review ratings and goal ratings comparable and
 * reports meaningful - free-text ratings would make every value
 * unique and unaggregatable. CDS validates enum values on write,
 * so an invalid rating is rejected by the framework itself.
 *
 *   Unsatisfactory       = 1
 *   NeedsImprovement     = 2
 *   MeetsExpectations    = 3
 *   ExceedsExpectations  = 4
 *   Outstanding          = 5
 */
type PerformanceRating : String enum {
    Unsatisfactory;
    NeedsImprovement;
    MeetsExpectations;
    ExceedsExpectations;
    Outstanding;
}

/*
 * Kind of review period (informational classification).
 */
type PerformanceReviewType : String enum {
    Annual;
    HalfYearly;
    Quarterly;
    Probation;
    Project;
}

// ============================================================
// SPRINT 15 - TIMESHEET, SHIFT & ROSTER INTEGRATION
// ------------------------------------------------------------
// Vocabulary for the timesheet domain. As in every other module the
// ALLOWED status transitions are enforced in srv/timesheet/handlers/*
// (timesheet-lifecycle.js); these enums only define the values.
// ============================================================

/*
 * Lifecycle of one timesheet (header + work items):
 *
 *   Draft -> Submitted -> InReview -> Approved
 *   with side exits:
 *     - Reject (Submitted/InReview -> Draft, editable again)
 *     - Withdraw (employee takes back a Submitted/InReview sheet)
 *     - Cancel (Draft/Submitted/InReview -> Cancelled, final)
 *     - Reopen (Approved -> Draft, HR-controlled correction path)
 *
 * An Approved timesheet becomes payroll input; once payroll has
 * consumed it the sheet is frozen (see Timesheet.payrollConsumedOn).
 */
type TimesheetStatus : String enum {
    Draft;
    Submitted;
    InReview;
    Approved;
    Rejected;    // transitional note status: reviewerComments hold the reason;
                 // handlers move rejected sheets back to Draft immediately
    Cancelled;   // final, non-payroll-countable
}

/*
 * One row of the append-only timesheet approval/correction ledger.
 * Every lifecycle action (package timesheet-lifecycle.js) writes
 * exactly one history row - the reviewer trail the reports and the
 * correction discussions are built from.
 */
type TimesheetAction : String enum {
    Created;
    Submitted;
    Withdrawn;
    ReviewStarted;
    Approved;
    Rejected;
    Reopened;
    Cancelled;
    PayrollConsumed;
}

// ============================================================
// SPRINT 16 - GEO TRACKING & GEO-FENCING
// ------------------------------------------------------------
// Vocabulary for the geo domain. Values are the server-calculated
// evaluation vocabulary ONLY - a client never submits any of these,
// the geofence validator computes them ([srv/geo/geofence-validator.js]).
// ============================================================

/*
 * Which attendance operation produced the location evidence.
 */
type GeoEventType : String enum {
    CheckIn;
    CheckOut;
}

/*
 * Server-computed outcome of the geofence evaluation:
 *   Passed   - coordinates inside an allowed, active, effective fence;
 *   Bypassed - validation not applicable (no active geofence config,
 *              employee without eligibility, remote-work exception).
 * A FAILED evaluation is a rejected request: the transaction is
 * rolled back, so no Failed row can ever be persisted - that is why
 * the vocabulary has no 'Failed' member. (Documented in SPRINT-16.md.)
 */
type GeoEvaluationResult : String enum {
    Passed;
    Bypassed;
}

/*
 * Append-only geofence configuration ledger actions.
 */
type GeofenceAction : String enum {
    Created;
    Updated;
    Activated;
    Deactivated;
}

// ============================================================
// SPRINT 17 - DOCUMENTS & COMPLIANCE
// ------------------------------------------------------------
// Vocabulary for the document/compliance domain. The ALLOWED
// transitions are enforced in srv/employee/handlers/document.js
// and srv/compliance/handlers/* - these enums only define the
// values (the same convention as every other module).
// ============================================================

/*
 * Life of the DOCUMENT FILE ROW (not the bytes on disk).
 *   Active   - current, usable version; one per employee+type
 *              (duplicate guard in the upload handler).
 *   Archived - replaced or withdrawn by HR; kept for retention
 *              and audit history, ignored by compliance checks.
 *   Replaced - set automatically when a newer document of the
 *              same employee+documentType was created.
 */
type DocumentStatus : String enum {
    Active;
    Archived;
    Replaced;
}

/*
 * Verification workflow of one document (independent of its
 * Active/Archived row status):
 *   Pending -> Verified  (HR confirmation that the document is
 *   Pending -> Rejected  authentic and complete)
 * A Rejected or Verified document's verification is final - ask
 * the employee to upload a new Active document instead.
 *
 * IMPORTANT: a document's PRESENCE never implies compliance.
 * Compliance (Sprint 17) counts only Verified + not-expired
 * Active documents against their configured requirements.
 */
type DocumentVerificationStatus : String enum {
    Pending;
    Verified;
    Rejected;
}

/*
 * Per-requirement compliance line status (computed, in
 * srv/compliance/handlers/summaries.js):
 *   Compliant - verified Active document, not expiring soon
 *   Expiring  - valid, but expires within the configured
 *               expiryAlertDays of the requirement
 *   Expired   - verified document past its expiryDate
 *   Missing   - required document type not uploaded at all
 *   Pending   - uploaded but not yet verified by HR
 *   Rejected  - upload rejected by HR verification
 */
type ComplianceLineStatus : String enum {
    Compliant;
    Expiring;
    Expired;
    Missing;
    Pending;
    Rejected;
}

/*
 * Employee-level summary status (computed):
 *   Compliant  - no mandatory issue at all (expiring warnings
 *                are informational and do NOT downgrade this)
 *   Incomplete - a mandatory document is missing or pending
 *                verification
 *   Overdue    - a mandatory document is expired or was 
 *                rejected (consequence-prone state)
 */
type EmployeeComplianceStatus : String enum {
    Compliant;
    Incomplete;
    Overdue;
}
// ============================================================
// SPRINT 18 - EMPLOYEE ENGAGEMENT
// Shared vocabulary for the engagement module (surveys,
// suggestions/feedback, recognitions). Lifecycle transitions
// themselves are enforced in srv/engagement/handlers - these
// enums are only the naming convention, like every other module.
// ============================================================

/*
 * Lifecycle of one engagement survey. Allowed transitions:
 *   Draft -> Published -> Closed -> Archived
 * (enforced by the Publish / Close / Archive bound actions; a
 * Draft admin DELETE is the only removal path - Published and
 * later surveys are kept for reporting history).
 */
type SurveyStatus : String enum {
    Draft;
    Published;
    Closed;
    Archived;
}

/*
 * Answer shape of one survey question. Runtime validation must
 * check the ANSWER against THIS type (see handlers/surveys.js):
 *   Text    -> textValue   (non-empty string)
 *   Rating  -> numberValue (integer 1..5)
 *   YesNo   -> boolValue   (true = yes, false = no)
 *   Choice  -> choiceValue (one of the configured options)
 */
type SurveyResponseType : String enum {
    Text;
    Rating;
    YesNo;
    Choice;
}

/*
 * Lifecycle of one survey response row. 'Withdrawn' keeps the
 * fact for reporting but disconnects it from the results.
 */
type SurveyResponseStatus : String enum {
    Submitted;
    Withdrawn;
}

/*
 * Journey of one employee suggestion.
 *   Submitted -> InReview -> Accepted / Rejected / Closed.
 * Employees cannot edit a suggestion after it leaves 'Submitted'
 * (review stage) - documented in HANDLERS.
 */
type SuggestionStatus : String enum {
    Submitted;
    InReview;
    Accepted;
    Rejected;
    Closed;
}

/* Free-category business vocabulary for suggestions. */
type SuggestionCategory : String enum {
    Facilities;
    Process;
    Culture;
    IT;
    Other;
}

/* Free-category business vocabulary for recognitions ("kudos"). */
type RecognitionCategory : String enum {
    Teamwork;
    Innovation;
    CustomerService;
    Leadership;
    Other;
}

// ============================================================
// SPRINT 20 - HR SUPPORT / HELPDESK
// Shared vocabulary for the helpdesk module. The ALLOWED
// lifecycle transitions are enforced in srv/helpdesk/handlers/*
// - these enums only define the values (same convention as
// every other module).
// ============================================================

/*
 * Configurable request categories (B4). Deliberately a fixed,
 * neutral vocabulary - no company-specific SLA or routing rules
 * are embedded anywhere; SLA targets live in the
 * HRTicketCategoryConfig table and stay nullable/off by default.
 */
type HRTicketCategory : String enum {
    PayrollQuery;
    LeaveQuestion;
    EmployeeRecords;
    Benefits;
    PolicyClarification;
    GeneralHR;
}

/* How urgently the ticket needs attention (agent triage input;
 * nothing is auto-escalated - there is no background scheduler). */
type HRTicketPriority : String enum {
    Low;
    Medium;
    High;
    Urgent;
}

/*
 * Lifecycle of ONE ticket (see db/helpdesk/helpdesk.cds):
 *
 *   New -> Assigned -> InProgress -> WaitingForEmployee
 *                              \\-> Resolved -> Closed
 *   WaitingForEmployee -> InProgress   (employee answers)
 *   Resolved/Closed -> InProgress     (Reopen, event kept)
 *
 * A reopened ticket keeps its ENTIRE status/event/comment
 * history - rows are never deleted.
 */
type HRTicketStatus : String enum {
    New;
    Assigned;
    InProgress;
    WaitingForEmployee;
    Resolved;
    Closed;
}

/* Who may see a comment: InternalNote is HR/agent-only and is
 * filtered out of every requester read server-side. */
type HRTicketCommentKind : String enum {
    InternalNote;
    AgentResponse;
    EmployeeResponse;
}

// ============================================================
// SPRINT 19 - HR POLICY MANAGEMENT
// Shared vocabulary for the HR policy module. The ALLOWED
// lifecycle transitions are enforced in srv/hr-policy/handlers/*
// - these enums only define the values (same convention as
// every other module).
// ============================================================

/*
 * Free-category business vocabulary for policies. Applicability
 * (company / country / department / employment type) lives on the
 * Policy header as configurable fields - nothing legal is
 * hardcoded per country.
 */
type PolicyCategory : String enum {
    CodeOfConduct;
    AttendanceAndLeave;
    Compensation;
    WorkplaceSafety;
    InformationSecurity;
    Other;
}

/*
 * Lifecycle of ONE policy version (see db/hr-policy/hr-policy.cds):
 *
 *   Draft -> InReview -> Approved -> Published -> (Superseded)
 *                              \-> Rejects back to Draft
 *   Published -> Withdrawn -> Archived
 *
 * 'Superseded' is set automatically when a NEWER version of the
 * same policy is published; the old version (and the
 * acknowledgment records pointing at it) is NEVER deleted - it
 * IS the history that "acknowledged version X" refers to.
 */
type PolicyVersionStatus : String enum {
    Draft;
    InReview;
    Approved;
    Published;
    Superseded;
    Withdrawn;
    Archived;
}

// ============================================================
// SPRINT 21 - EXIT MANAGEMENT
// ------------------------------------------------------------
// Shared enums for the exit/separation domain. They follow the
// same central-enum convention as every other module.
//
// NO legal quantities are encoded here: notice periods, retention
// periods and country-specific rules live in CONFIGURATION
// (ExitNoticePolicy, maintained by HR), never in these values.
// ============================================================

/*
 * WHY an exit case is being raised. Deliberately neutral and
 * process-shaped, not legal-text-shaped. 'EmployerInitiated' is
 * the sensitive one: its case gets extra access restrictions
 * (see srv/exit/exit-security.cds + the after-READ reason mask).
 */
type ExitType : String enum {
    Resignation;
    Retirement;
    ContractCompletion;
    EmployerInitiated;
}

/*
 * Lifecycle of one exit case (enforced ONLY by the bound actions
 * in srv/exit/handlers - ExitCases has no UPDATE/DELETE grant for
 * anyone, so a direct PATCH can never move a status):
 *
 *   Draft -> Submitted -> InReview -> Approved
 *             -> ClearanceInProgress -> ReadyForSeparation
 *             -> Completed
 *
 * Side exits, each authorized by a specific actor:
 *   Submitted/InReview -> Rejected   (workflow decision)
 *   Submitted/InReview -> Withdrawn  (requester/HR)
 *   Rejected           -> Draft      (Reconsider, HR, audited)
 *   SendBack (Rework)  -> Draft       (workflow SendBack)
 *   workflow Cancelled -> Cancelled
 */
type ExitStatus : String enum {
    Draft;
    Submitted;
    InReview;
    Approved;
    ClearanceInProgress;
    ReadyForSeparation;
    Completed;
    Rejected;
    Withdrawn;
    Cancelled;
}

/*
 * Neutral reason vocabulary (HR-maintained configuration question,
 * not a legal claim). 'Performance'/'Redundancy' typically happen
 * only with EmployerInitiated exits.
 */
type ExitReasonCategory : String enum {
    Personal;
    Health;
    Career;
    Relocation;
    Retirement;
    ContractEnd;
    Performance;
    Redundancy;
    Other;
}

/*
 * Notice-period snapshot status of a case. 'NotConfigured' is a
 * deliberate value: it surfaces the MISSING CONFIGURATION (the HR
 * policy gap) instead of silently pretending no notice applies.
 */
type NoticePeriodStatus : String enum {
    NotConfigured;
    Met;
    Waived;
}

/*
 * Who a clearance item is for. Holds a CAP ROLE name so the
 * completion action can re-check authorization server-side
 * (completing an item is the statement "facilities returned",
 * so the actor must belong to the responsible function).
 */
type ClearanceResponsibleRole : String enum {
    HR;         // HRExecutive / HRAdmin
    Manager;    // the employee's reporting manager
    ITAdmin;    // SystemAdmin in this project (documented)
    Finance;    // FinanceManager / PayrollExecutive
}

/*
 * Which DOMAIN an item clears. The completion VALIDATION is keyed
 * on this value (Asset items verify the asset ledger, Document
 * items verify linked documents) - see exit-clearance.js.
 */
type ClearanceCategory : String enum {
    Asset;
    Document;
    HR;
    Manager;
    IT;
    Finance;
    Other;
}

/*
 * Status of ONE clearance item.
 */
type ClearanceItemStatus : String enum {
    Pending;
    Complete;
    NotApplicable;
}

/*
 * Where the exit-related payroll work stands. Only a PAYROLL-role
 * user can move Pending -> Complete, and only with EVIDENCE from
 * the existing Payroll module (a processed/approved/payroll
 * process row that covers the separation month). The exit module
 * deliberately contains NO settlement calculation.
 */
type ExitPayrollStatus : String enum {
    Pending;
    Complete;
}

/*
 * Whether the whole departure processing is done (set by the
 * CompleteExit action, never by a direct PATCH).
 */
type ExitProcessingStatus : String enum {
    Pending;
    Completed;
}

/*
 * Free-form event labels in ExitEvent (String on purpose, like
 * HRTicketEvent - later events must not require enum migrations).
 */
// (kept as plain String columns; no enum needed)
