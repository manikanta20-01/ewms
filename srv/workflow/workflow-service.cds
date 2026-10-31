using { ewms.db.workflow as db } from '../../db/schema';

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW AND APPROVAL ENGINE (SERVICE)
// ------------------------------------------------------------
// One reusable service (WorkflowService) exposes the whole
// engine. Business modules integrate in two ways:
//
//   1. As a REQUESTER (e.g. Leave): they bind the unbound
//      StartWorkflow action (see srv/leave/leave-service.cds)
//      and implement two business callbacks (module-callbacks.js).
//
//   2. As an APPROVER (any module): approvers act directly on
//      WorkflowTasks / WorkflowInstances through this service -
//      they never need module-specific screens.
//
// Security lives in workflow-security.cds and reuses the
// Sprint 9 roles (no separate security framework).
// ============================================================

service WorkflowService @(requires: 'authenticated-user') {

    // ---------------------------------------------------------
    // Configuration entities (who may read/maintain them is
    // decided in workflow-security.cds)
    // ---------------------------------------------------------
    entity WorkflowDefinitions as projection on db.WorkflowDefinition;
    entity WorkflowSteps       as projection on db.WorkflowStep;

    // ---------------------------------------------------------
    // Runtime entities
    // ---------------------------------------------------------
    entity WorkflowInstances as projection on db.WorkflowInstance actions {
        // Cancel a running instance (requester withdraws, or
        // HR/SystemAdmin intervenes). Fully validated in engine.
        action CancelWorkflow(comments : String(500)) returns String;

        // Requester-only: restart the journey at step 1 after a
        // SendBack put the instance into 'Rework'.
        action ResubmitWorkflow() returns String;
    };

    entity WorkflowTasks as projection on db.WorkflowTask actions {
        // Approve the task and (if it was the last step) complete
        // the whole workflow.
        action Approve(comments : String(500)) returns String;

        // Reject the task - terminates the instance as Rejected.
        // Requires comments (business rule, see engine).
        action Reject(comments : String(500)) returns String;

        // Send the work back to the requester for correction
        // (Rework). Requires comments.
        action SendBack(comments : String(500)) returns String;

        // Hand THIS task to another employee immediately
        // (one-off, no date range). Target must exist and not
        // be the requester (self-approval guard).
        action Reassign(newAssignee_ID : UUID, comments : String(500)) returns String;

        // Forward THIS task to someone else to act for me
        // (decision is recorded as decidedVia 'Delegation' with
        //  the original assignee retained on the task).
        action Delegate(delegate_ID : UUID, comments : String(500)) returns String;

        // Escalate an OPEN task that passed its due date (or any
        // open task with a reason) to the department HR
        // representative. Restricted to HR roles + SystemAdmin.
        action EscalateTask(comments : String(500)) returns String;
    };

    entity WorkflowHistories as projection on db.WorkflowHistory;

    // Delegations: users manage their OWN delegations through
    // these entities; row-level restrictions are in
    // workflow-security.cds, extra business validation in the
    // delegation handler.
    entity WorkflowDelegations as projection on db.WorkflowDelegation;

    // ---------------------------------------------------------
    // UNBOUND ACTION - starts a workflow for a business object
    // ---------------------------------------------------------
    // Called by business modules, e.g. Leave:
    //   POST /odata/v4/leave/StartWorkflow
    //        { "businessObjectId": "<LeaveRequest ID>" }
    // The engine picks the ACTIVE WorkflowDefinition matching the
    // business object's entity name. Generic by design.
    action StartWorkflow(
        businessObjectType : String(100),
        businessObjectId   : UUID,
        summary            : String(255)
    ) returns String;
}
