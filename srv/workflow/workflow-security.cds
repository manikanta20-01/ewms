using WorkflowService from './workflow-service';

// ============================================================
// SPRINT 10 - WORKFLOW SECURITY (reuses Sprint 9 model)
// ------------------------------------------------------------
// No new security framework: the same roles defined in
// package.json / xs-security.json and centrally in
// srv/common/auth/roles.js apply here.
//
// Design decisions:
//  * Definition/step maintenance is configuration work -> HRAdmin
//    and SystemAdmin only.
//  * Instances/tasks are read-restricted by role groups instead of
//    a blanket "authenticated-user" READ, so a plain Employee sees
//    only workflows they participate in. Tight row-level filtering
//    is enforced in the engine handlers on top of these grants
//    (workflow-engine.js -> assertTaskAccess), because OData where
//    clauses cannot express delegated-task visibility.
//  * Actions are additionally guarded at runtime: the engine
//    checks task ownership, delegation validity and self-approval
//    rules per request (defense in depth: @restrict first, then
//    engine checks).
//  * SystemAdmin keeps the project-wide bypass via
//    srv/common/auth/authorization.js and full CRUD here.
// ============================================================

annotate WorkflowService with @(requires: 'authenticated-user');

// 1. Configuration: definitions & steps
annotate WorkflowService.WorkflowDefinitions with @restrict: [
    { grant: ['READ'],                                to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'],          to: ['HRAdmin', 'SystemAdmin'] }
];

annotate WorkflowService.WorkflowSteps with @restrict: [
    { grant: ['READ'],                                to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'],          to: ['HRAdmin', 'SystemAdmin'] }
];

// 2. Runtime: instances (who may look at running workflows)
annotate WorkflowService.WorkflowInstances with @restrict: [
    { grant: ['READ'],                                to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    // Instances are only created through StartWorkflow - never
    // written directly - and only cancelled/resubmitted through
    // their actions (the engine enforces requester/HR rules).
    { grant: ['CancelWorkflow', 'ResubmitWorkflow'],  to: ['Employee', 'HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

// 3. Runtime: tasks (the approver's worklist)
annotate WorkflowService.WorkflowTasks with @restrict: [
    { grant: ['READ'],                                to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['Approve', 'Reject', 'SendBack', 'Delegate'], to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['Reassign'],                            to: ['DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['EscalateTask'],                        to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

// 4. History: HR / Finance / managers / SystemAdmin only.
//    Not writable by anyone: the engine writes history
//    internally on every transition; handlers block direct
//    UPDATE/DELETE (see workflow-engine.js + history guard).
annotate WorkflowService.WorkflowHistories with @restrict: [
    { grant: ['READ'],                                to: ['DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] }
];

// 5. The generic unbound StartWorkflow is a BACK-OFFICE action
//    (HR/SystemAdmin). Business modules expose their own bound
//    StartWorkflow actions (e.g. LeaveService.LeaveRequests)
//    where ownership is enforced per request.
annotate WorkflowService.StartWorkflow with @(requires: ['HRAdmin', 'SystemAdmin']);

// 6. Delegations: every authenticated user may see and create
//    their OWN delegations (row-level where-clauses below);
//    only HRAdmin/SystemAdmin may see and maintain all.
annotate WorkflowService.WorkflowDelegations with @restrict: [
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'],  to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'], where: 'delegator_ID = $user.employeeId' },
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],  to: ['HRAdmin', 'SystemAdmin'] }
];
