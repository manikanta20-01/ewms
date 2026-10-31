namespace ewms.db.workflow;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW AND APPROVAL ENGINE
// ------------------------------------------------------------
// A WorkflowDefinition is a REUSABLE APPROVAL TEMPLATE that is
// configured once (e.g. "Leave Approval", "Payroll Approval")
// and can then drive any number of business objects through it.
//
// The engine is deliberately business-agnostic: it never hardcodes
// "leave" or "payroll". A definition only knows
//   * which business object type it serves (businessObjectType)
//   * which ordered steps (WorkflowStep) the request travels through
//
// This is what makes the same engine reusable later for Payroll,
// Document Verification, Recruitment, Performance, Assets,
// Timesheet, Compliance, and future processes WITHOUT any new
// workflow implementation per module.
// ============================================================

entity WorkflowDefinition : managed {
    key ID : UUID;

    // Human-readable identifier, e.g. "WF-LEAVE-STD".
    // Unique so configuration can be referenced by code.
    definitionCode : String(20) @assert.unique;

    name            : type.Name100;
    description     : type.Description;

    // -----------------------------------------------------------
    // WHICH BUSINESS OBJECT THIS DEFINITION SERVES
    // -----------------------------------------------------------
    // Free-form CDS entity name of the business object, e.g.
    //   "ewms.db.leave.LeaveRequest"
    // Storing the entity NAME (not an association) is the key
    // design decision that keeps the engine generic: associations
    // would hard-wire the engine to one specific module.
    // The engine resolves the real row at runtime via the
    // businessObjectId carried on WorkflowInstance.
    businessObjectType : String(100);

    // -----------------------------------------------------------
    // HOW WORKLOAD IS DISTRIBUTED ACROSS STEPS
    // -----------------------------------------------------------
    // * SingleSequential : one approver per step (classic chain:
    //     Manager -> HR -> Finance)
    // * AllMustApprove   : every task of a step must approve before
    //     the next step opens (parallel blocks)
    // * AnyCanApprove    : first approval of a step moves the
    //     instance forward, siblings are skipped (parallel voting)
    // A step-level mode (WorkflowStep.approvalMode) can override
    // this default for individual steps.
    approvalType : enums.StepApprovalMode default 'SingleSequential';

    // Self-approval rule: when true, the requester is allowed to
    // approve their own request. Default false = business standard:
    // nobody approves their own work. Enforced in the engine.
    allowSelfApproval : Boolean default false;

    // Only 'Active' definitions can start new workflow instances.
    status : enums.WorkflowDefinitionStatus default 'Active';

    // Ordered journey of this definition.
    steps : Composition of many WorkflowStep on steps.definition = $self;
}

// ============================================================
// ONE STEP INSIDE A DEFINITION
// ------------------------------------------------------------
// stepNumber defines the sequential order (1, 2, 3 ...).
// approverType decides HOW the actual approver is found at
// runtime (specific person, role, requester's manager, or the
// department HR) - resolution happens in
// srv/workflow/handlers/step-resolvers.js.
// ============================================================
entity WorkflowStep : managed {
    key ID : UUID;

    definition : Association to WorkflowDefinition not null;

    // Execution order inside the definition (1 = first approver).
    stepNumber : Integer not null;

    name : type.Name100;

    // How the approver for this step is determined.
    approverType : enums.StepApproverType not null;

    // Used depending on approverType:
    //  * Position : UUID of the fixed approver (Employee)
    //  * Role     : CAP role name, e.g. "HRExecutive"
    //  * Manager  : ignored (resolved from the requester's
    //               EmployeeAssignment)
    //  * LevelHR  : ignored (resolved from DepartmentHR)
    approverValue : String(100);

    // Overrides the definition-level distribution mode for this
    // step only (parallel approvals per step).
    approvalMode : enums.StepApprovalMode;

    // Optional service-level deadline in days. Currently exposed
    // for display/monitoring; escalation is action-based
    // (EscalateTask) in this sprint, not a scheduled job.
    slaDays : Integer;

    // Optional extra behaviour flags:
    //  * skipIfSameAsRequester : move to the next step instead of
    //    assigning a task when the resolved approver IS the
    //    requester (self-approval avoidance)
    //  * mandatoryStep         : this step cannot be skipped
    skipIfSameAsRequester : Boolean default true;
    mandatoryStep         : Boolean default true;
}
