namespace ewms.db.workflow;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.workflow.WorkflowDefinition } from './workflow-definition';
using { ewms.db.workflow.WorkflowStep } from './workflow-definition';

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW AND APPROVAL ENGINE (RUNTIME)
// ------------------------------------------------------------
// A WorkflowInstance is ONE running approval journey:
//   requester submits business object  ->  engine snapshots the
//   matching WorkflowDefinition  ->  creates WorkflowTasks step
//   by step until the instance reaches a final status
//   (Approved / Rejected / Cancelled / Terminated / Rework).
//
// The link back to the business object is intentionally stored as
// two plain strings (businessObjectType + businessObjectId) instead
// of associations, so the SAME engine can drive Leave, Payroll,
// Timesheet, ... without schema changes per module. Modules that
// want a typed lookup can filter on these two fields.
// ============================================================

entity WorkflowInstance : managed {
    key ID : UUID;

    // Business reference, e.g.
    //   businessObjectType = "ewms.db.leave.LeaveRequest"
    //   businessObjectId   = "<UUID of the leave request row>"
    businessObjectType : String(100) not null;
    businessObjectId   : UUID not null;

    // Snapshot of the definition used. Kept as an association so
    // configuration changes never silently alter running instances.
    definition : Association to WorkflowDefinition not null;

    // Denormalized copy of the requester (the employee who owns the
    // business object). Copied at start time for fast queries
    // ("my submitted workflows") without joining business tables.
    requester : Association to Employee not null;

    // Where the journey currently stands.
    currentStep : Association to WorkflowStep;
    status      : enums.WorkflowInstanceStatus default 'Running';

    // Free short comment provided when starting (visible to approvers).
    summary : String(255);

    tasks : Composition of many WorkflowTask on tasks.instance = $self;
    history : Composition of many WorkflowHistory on history.instance = $self;
}

// ============================================================
// ONE TASK = ONE APPROVER x ONE STEP
// ------------------------------------------------------------
// For sequential steps there is exactly one open task per step.
// For parallel steps (AllMustApprove / AnyCanApprove) several
// sibling tasks are created for the SAME step at the same time.
// ============================================================
entity WorkflowTask : managed {
    key ID : UUID;

    instance : Association to WorkflowInstance not null;

    // Step snapshot: copied from WorkflowStep at task creation so
    // historic tasks keep their meaning even if the definition is
    // reconfigured later. currentStepNumber is the fast lookup used
    // by the engine to find "the tasks of the step I am on".
    step : Association to WorkflowStep;
    currentStepNumber : Integer not null;

    stepName : String(100);

    // Who must act on this task.
    assigneeType    : enums.StepApproverType not null;
    assigneeEmployee : Association to Employee;   // set when resolved to a person
    assigneeRole     : String(100);              // set for Role-based steps

    status : enums.WorkflowTaskStatus default 'Open';

    // Decision details, filled when the task is completed.
    decision    : enums.ApprovalDecision;
    decidedOn   : Timestamp;
    decisionBy  : Association to Employee;  // actual actor (may differ from assignee when delegated!)
    decidedVia  : String(20) enum { Direct; Delegation; Escalation; };
    comments    : String(500);

    // Due date = startedAt + slaDays (display/monitoring info).
    dueDate : Date;
}

// ============================================================
// IMMUTABLE HISTORY LEDGER
// ------------------------------------------------------------
// Every state transition of instance or task writes exactly one
// WorkflowHistory row. Rows are never updated or deleted by the
// application (enforced in handlers); only SystemAdmin keeps
// read access together with HR/Finance roles.
// ============================================================
entity WorkflowHistory : managed {
    key ID : UUID;

    instance : Association to WorkflowInstance not null;

    // Correlation: which step/task was involved (null for
    // instance-level events like Submitted / Completed).
    stepNumber : Integer;
    task       : Association to WorkflowTask;

    action        : enums.WorkflowAction not null;
    previousStatus : enums.WorkflowInstanceStatus;
    newStatus      : enums.WorkflowInstanceStatus;

    actor         : Association to Employee not null;
    actionOn      : Timestamp not null;
    comments      : String(500);

    // Reserved for later integration with notifications/outbox.
    correlationId : String(100);
}

// ============================================================
// DELEGATION
// ------------------------------------------------------------
// Lets an authorized approver hand their PENDING approval work to
// another employee for a date range, without exposing anyone
// else's tasks. Scope can be narrowed to one definition or one
// concrete task; the engine only honours a delegation while
//   fromDate <= today <= toDate
// and the delegator really owns the task.
// ============================================================
entity WorkflowDelegation : managed {
    key ID : UUID;

    // Who gives the work away - always the logged-in user; the
    // engine rejects delegating on behalf of somebody else.
    delegator : Association to Employee not null;

    // Who receives the work.
    delegate : Association to Employee not null;

    // Optional narrowing of scope:
    //  * definition set  -> only tasks of that workflow definition
    //  * task set        -> exactly that one task
    //  * both empty      -> all workflow tasks of the delegator
    definition : Association to WorkflowDefinition;
    task       : Association to WorkflowTask;

    fromDate : Date not null;
    toDate   : Date not null;

    reason    : String(255);
    status    : enums.Status default 'Active';   // Active / Inactive / Closed
}
