const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const auth = require("../../common/auth/authorization");
const { getCallbacks } = require("./business-callbacks");
const { resolveStepApprovers, findDepartmentHR } = require("./step-resolvers");

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW AND APPROVAL ENGINE (CORE)
// ------------------------------------------------------------
// ALL state transitions of the engine live in this file. The
// golden rules enforced everywhere:
//
//   R1  Definition must be Active when starting a new instance.
//   R2  A completed workflow cannot be approved again.
//   R3  A rejected task cannot be approved unless the workflow
//       explicitly supports resubmission (SendBack -> Rework ->
//       ResubmitWorkflow flow).
//   R4  A user must not act on a task that is not assigned to
//       them, unless an authorized delegation covers the task
//       (WorkflowDelegation with date range, or a per-task
//       Delegate action recorded on the task).
//   R5  Rejection and SendBack always need a reason (comments).
//   R6  Every transition writes one immutable WorkflowHistory row.
//   R7  Self-approval: the requester can never approve their own
//       instance unless the definition's allowSelfApproval is on.
//
// Parallel approvals are supported through step approval modes
// (SingleSequential / AllMustApprove / AnyCanApprove) without any
// per-module workflow code.
// ============================================================

const INSTANCE_ENTITY = "ewms.db.workflow.WorkflowInstance";
const TASK_ENTITY = "ewms.db.workflow.WorkflowTask";
const STEP_ENTITY = "ewms.db.workflow.WorkflowStep";
const HISTORY_ENTITY = "ewms.db.workflow.WorkflowHistory";
const DEFINITION_ENTITY = "ewms.db.workflow.WorkflowDefinition";
const DELEGATION_ENTITY = "ewms.db.workflow.WorkflowDelegation";
const EMPLOYEE_ENTITY = "ewms.db.employee.Employee";

// ============================================================
// SMALL SHARED HELPERS
// ============================================================

/** Current timestamp in ISO format (project convention). */
function now() {
  return new Date().toISOString();
}

/** Who is acting: the logged-in user's employee ID, if known. */
function actorId(req) {
  return req.user?.attr?.employeeId || null;
}

/**
 * Writes one immutable history row (R6). Called on EVERY
 * transition of instance or task state.
 */
async function writeHistory(tx, instance, entry) {
  await tx.run(
    INSERT.into(HISTORY_ENTITY).entries({
      ID: cds.utils.uuid(),
      instance_ID: instance.ID,
      stepNumber: entry.stepNumber ?? null,
      task_ID: entry.taskId ?? null,
      action: entry.action,
      previousStatus: entry.previousStatus ?? null,
      newStatus: entry.newStatus ?? null,
      actor_ID: entry.actorId,
      actionOn: now(),
      comments: entry.comments ?? null,
    }),
  );
}

/**
 * Loads an instance together with its definition snapshot
 * (definition attached as .definition for engine logic).
 */
async function loadInstanceLean(tx, instanceId) {
  const instance = await tx.run(
    SELECT.one.from(INSTANCE_ENTITY).where({ ID: instanceId }),
  );
  if (!instance) return null;
  const definition = await tx.run(
    SELECT.one.from(DEFINITION_ENTITY).where({ ID: instance.definition_ID }),
  );
  return { ...instance, definition };
}

/**
 * Approval mode of a given step number: the step's own mode wins,
 * otherwise the definition-level default applies.
 */
async function stepMode(tx, definition, stepNumber) {
  const step = await tx.run(
    SELECT.one.from(STEP_ENTITY).where({
      definition_ID: definition.ID,
      stepNumber,
    }),
  );
  const mode = step?.approvalMode || definition.approvalType || "SingleSequential";
  return mode === "AllMustApprove" || mode === "AnyCanApprove" ? mode : "SingleSequential";
}

/**
 * Number of the step the instance is currently waiting on:
 * the lowest step number that still has OPEN tasks; if none are
 * open (parallel fully decided, instance about to advance), fall
 * back to the highest step that has any tasks.
 */
async function getCurrentStepNumber(tx, instanceId) {
  const openTask = await tx.run(
    SELECT.one.from(TASK_ENTITY)
      .where({ instance_ID: instanceId, status: "Open" })
      .orderBy({ currentStepNumber: "asc" }),
  );
  if (openTask) return openTask.currentStepNumber;
  const lastTask = await tx.run(
    SELECT.one.from(TASK_ENTITY)
      .where({ instance_ID: instanceId })
      .orderBy({ currentStepNumber: "desc" }),
  );
  return lastTask ? lastTask.currentStepNumber : 1;
}

/** Keep instance.currentStep pointing at the step in progress. */
async function refreshCurrentStep(tx, instanceId, stepNumber) {
  const instance = await tx.run(
    SELECT.one.from(INSTANCE_ENTITY).where({ ID: instanceId }),
  );
  if (!instance) return;
  const step = await tx.run(
    SELECT.one.from(STEP_ENTITY).where({
      definition_ID: instance.definition_ID,
      stepNumber,
    }),
  );
  await tx.run(
    UPDATE(INSTANCE_ENTITY)
      .set({ currentStep_ID: step?.ID ?? null })
      .where({ ID: instanceId }),
  );
}

// ============================================================
// TASK ACCESS CONTROL (R4)
// ============================================================

/**
 * Access check used by Approve / Reject / SendBack / Delegate.
 *
 * Allowed when:
 *  - SystemAdmin (project-wide bypass rule), or
 *  - the user IS the assignee, or
 *  - the user is the recorded per-task delegate (set via the
 *    Delegate action), or
 *  - an ACTIVE WorkflowDelegation FROM the assignee TO the user
 *    covers today's date and matches the task's scope
 *    (task-scoped, definition-scoped or global).
 */
async function assertTaskAccess(req, tx, task) {
  if (auth.isSystemAdmin(req)) return;

  const me = actorId(req);
  if (!me) {
    return req.error(
      403,
      "Your user is not linked to an employee; you cannot act on workflow tasks.",
    );
  }

  if (task.assigneeEmployee_ID === me) return;

  // Role-queue task (no concrete assignee): the caller holds the
  // role the task was routed to (approverValue / assigneeRole),
  // e.g. a step routed to 'HRExecutive' is approvable by any
  // active HRExecutive. Without this check such a task could only
  // ever be decided by a SystemAdmin.
  if (task.assigneeRole && !task.assigneeEmployee_ID && req.user.is(task.assigneeRole)) {
    return;
  }

  // Per-task delegate recorded by the Delegate action.
  if (task.decisionBy_ID === me && task.status === "Open") return;

  // Date-ranged delegation from the assignee to me.
  const today = new Date().toISOString().slice(0, 10);
  const delegations = await tx.run(
    SELECT.from(DELEGATION_ENTITY).where({
      delegator_ID: task.assigneeEmployee_ID,
      delegate_ID: me,
      status: "Active",
      fromDate: { "<=": today },
      toDate: { ">=": today },
    }),
  );

  for (const d of delegations) {
    if (d.task_ID && d.task_ID !== task.ID) continue; // other task
    if (!d.definition_ID) return; // global delegation
    const instance = await tx.run(
      SELECT.one.from(INSTANCE_ENTITY).where({ ID: task.instance_ID }),
    );
    if (instance && instance.definition_ID === d.definition_ID) return;
  }

  return req.error(
    403,
    "You are not authorized to act on this task: you are neither the assignee nor an authorized delegate.",
  );
}

// ============================================================
// STEP OPENING (used by start / advance / resubmit)
// ============================================================

/**
 * Opens the tasks for step number N. Resolution, self-approval
 * filtering and automatic skip-forward for dead steps happen
 * here, so a broken step can never deadlock an instance.
 */
async function openStep(req, tx, instance, definition, stepNumber, previousStatus = "Running") {
  const step = await tx.run(
    SELECT.one.from(STEP_ENTITY).where({
      definition_ID: definition.ID,
      stepNumber,
    }),
  );
  if (!step) {
    // No step with this number -> definition journey ends.
    return completeInstance(req, tx, instance, previousStatus, null);
  }

  const requesterId = instance.requester_ID;
  const allowSelf = !!definition.allowSelfApproval;

  const approvers = await resolveStepApprovers(tx, step, instance);

  // R7 support: filter the requester out of approver lists
  // unless the definition explicitly allows self-approval.
  const effectiveApprovers = approvers.filter((a) => {
    if (!a.employeeId) return true; // role queues remain
    if (a.employeeId === requesterId && !allowSelf) return false;
    return true;
  });

  // Nobody eligible (e.g. requester IS the manager and
  // self-approval is off) -> skip to the next step automatically.
  if (effectiveApprovers.length === 0) {
    await writeHistory(tx, instance, {
      action: "Assigned",
      stepNumber,
      actorId: requesterId,
      comments: `Step ${stepNumber} (${step.name}) skipped: no eligible approver.`,
    });
    return openStep(req, tx, instance, definition, stepNumber + 1, previousStatus);
  }

  const mode = await stepMode(tx, definition, stepNumber);

  // Optional due date from the step's SLA setting.
  const dueDate = step.slaDays
    ? new Date(Date.now() + step.slaDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : null;

  for (const approver of effectiveApprovers) {
    await tx.run(
      INSERT.into(TASK_ENTITY).entries({
        ID: cds.utils.uuid(),
        instance_ID: instance.ID,
        step_ID: step.ID,
        currentStepNumber: stepNumber,
        stepName: step.name,
        assigneeType: approver.assigneeType,
        assigneeEmployee_ID: approver.employeeId || null,
        assigneeRole: approver.role || null,
        status: "Open",
        dueDate,
      }),
    );
    await writeHistory(tx, instance, {
      action: "Assigned",
      stepNumber,
      actorId: requesterId,
      comments: `Step ${stepNumber} (${step.name}) assigned to ${approver.name || approver.role}.`,
    });
  }

  return { stepNumber, mode };
}

// ============================================================
// FINAL STATES
// ============================================================

/** Completes the instance positively and notifies the module. */
async function completeInstance(req, tx, instance, previousStatus, comments) {
  await tx.run(
    UPDATE(INSTANCE_ENTITY)
      .set({ status: "Approved" })
      .where({ ID: instance.ID }),
  );

  await writeHistory(tx, instance, {
    action: "Completed",
    previousStatus: previousStatus || "Running",
    newStatus: "Approved",
    actorId: actorId(req) || instance.requester_ID,
    comments: comments || "All steps approved. Workflow completed.",
  });

  // Business module reaction (e.g. deduct leave balance).
  const callbacks = getCallbacks(instance.businessObjectType);
  if (callbacks.applyDecision) {
    await callbacks.applyDecision(tx, instance, "Approved", comments);
  }
  return "Approved";
}

/**
 * Moves the instance into a final status (Rejected / Cancelled /
 * Terminated), closes dangling open tasks, writes history and
 * notifies the business module.
 */
async function finalizeInstance(req, tx, instance, finalStatus, comments, taskId) {
  const before = instance.status || "Running";

  await tx.run(
    UPDATE(INSTANCE_ENTITY)
      .set({ status: finalStatus })
      .where({ ID: instance.ID }),
  );

  const openTasks = await tx.run(
    SELECT.from(TASK_ENTITY).where({ instance_ID: instance.ID, status: "Open" }),
  );
  for (const t of openTasks) {
    await tx.run(
      UPDATE(TASK_ENTITY).set({ status: "Cancelled" }).where({ ID: t.ID }),
    );
  }

  await writeHistory(tx, instance, {
    action:
      finalStatus === "Rejected" ? "Rejected"
      : finalStatus === "Cancelled" ? "Cancelled"
      : "Completed",
    previousStatus: before,
    newStatus: finalStatus,
    actorId: actorId(req) || instance.requester_ID,
    comments,
    taskId,
  });

  const callbacks = getCallbacks(instance.businessObjectType);
  if (callbacks.applyDecision) {
    await callbacks.applyDecision(tx, instance, finalStatus, comments);
  }
  return finalStatus;
}

/** Advance to the next step, or complete when journey ends. */
async function advanceAfterStep(req, tx, instance, definition, completedStepNumber, comments) {
  const nextStepNumber = completedStepNumber + 1;

  const nextStep = await tx.run(
    SELECT.one.from(STEP_ENTITY).where({
      definition_ID: definition.ID,
      stepNumber: nextStepNumber,
    }),
  );

  if (nextStep) {
    await openStep(req, tx, instance, definition, nextStepNumber);
    await refreshCurrentStep(tx, instance.ID, nextStepNumber);
    return `Moved to step ${nextStepNumber}.`;
  }

  return completeInstance(req, tx, instance, "Running", comments);
}

// ============================================================
// COMMON TASK LOADING + VALIDATION FOR TASK ACTIONS
// ============================================================

async function loadTaskForAction(req, tx) {
  const taskId = req.params?.[0]?.ID || req.params?.[0];
  if (!taskId) {
    req.error(400, "Task identifier missing.");
    return null;
  }

  const task = await tx.run(SELECT.one.from(TASK_ENTITY).where({ ID: taskId }));
  if (!task) {
    req.error(404, "Workflow task not found.");
    return null;
  }

  const instance = await loadInstanceLean(tx, task.instance_ID);
  if (!instance) {
    req.error(404, "Workflow instance not found.");
    return null;
  }

  // R2: only Running instances accept task decisions.
  if (instance.status !== "Running") {
    req.error(
      400,
      `Workflow instance is '${instance.status}'; no further task actions are possible.`,
    );
    return null;
  }

  return { task, instance };
}

// ============================================================
// TASK ACTIONS (exposed as bound OData actions)
// ============================================================

/**
 * Approve. SingleSequential: opens the next step or completes.
 * AllMustApprove: waits for sibling tasks of the same step.
 * AnyCanApprove: first approval wins, siblings are skipped.
 */
async function approveTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task, instance } = loaded;

  await assertTaskAccess(req, tx, task);
  if (req.errors?.length) return;

  if (task.status !== "Open") {
    // R3: rejected/closed tasks cannot be approved.
    return req.error(
      400,
      `Task is '${task.status}'; only open tasks can be approved. Use the resubmission flow after a SendBack.`,
    );
  }

  const me = actorId(req);

  // R7: self-approval guard (assignee == requester).
  if (
    me &&
    me === instance.requester_ID &&
    task.assigneeEmployee_ID === me &&
    !instance.definition.allowSelfApproval
  ) {
    return req.error(403, "Self-approval is not allowed for this workflow.");
  }

  const comments = req.data?.comments || null;

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({
        status: "Approved",
        decision: "Approved",
        decidedOn: now(),
        decisionBy_ID: me,
        // Acting as someone else's delegate is recorded explicitly.
        decidedVia: me === task.assigneeEmployee_ID ? "Direct" : "Delegation",
        comments,
      })
      .where({ ID: task.ID }),
  );

  await writeHistory(tx, instance, {
    action: "Approved",
    stepNumber: task.currentStepNumber,
    taskId: task.ID,
    previousStatus: "Running",
    newStatus: "Running",
    actorId: me,
    comments,
  });

  const mode = await stepMode(tx, instance.definition, task.currentStepNumber);

  if (mode === "AnyCanApprove") {
    // First decision wins: skip remaining siblings.
    const siblings = await tx.run(
      SELECT.from(TASK_ENTITY).where({
        instance_ID: instance.ID,
        currentStepNumber: task.currentStepNumber,
        status: "Open",
      }),
    );
    for (const s of siblings) {
      await tx.run(
        UPDATE(TASK_ENTITY).set({ status: "Skipped" }).where({ ID: s.ID }),
      );
    }
    return advanceAfterStep(req, tx, instance, instance.definition, task.currentStepNumber, comments);
  }

  // SingleSequential / AllMustApprove: wait for open siblings.
  const remaining = await tx.run(
    SELECT.from(TASK_ENTITY).where({
      instance_ID: instance.ID,
      currentStepNumber: task.currentStepNumber,
      status: "Open",
    }),
  );
  if (remaining.length > 0) {
    return `Task approved. Waiting for ${remaining.length} more approval(s) in this step.`;
  }

  return advanceAfterStep(req, tx, instance, instance.definition, task.currentStepNumber, comments);
}

/**
 * Reject: task is closed as Rejected and the WHOLE instance is
 * finalized as 'Rejected' (R5: comments mandatory).
 */
async function rejectTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task, instance } = loaded;

  await assertTaskAccess(req, tx, task);
  if (req.errors?.length) return;

  if (task.status !== "Open") {
    return req.error(400, `Task is '${task.status}'; only open tasks can be rejected.`);
  }

  const comments = req.data?.comments;
  if (!comments || !comments.trim()) {
    return req.error(400, "Comments are mandatory when rejecting a workflow task.");
  }

  const me = actorId(req);

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({
        status: "Rejected",
        decision: "Rejected",
        decidedOn: now(),
        decisionBy_ID: me,
        decidedVia: "Direct",
        comments,
      })
      .where({ ID: task.ID }),
  );

  return finalizeInstance(req, tx, instance, "Rejected", comments, task.ID);
}

/**
 * SendBack: closes this task, skips the remaining open tasks and
 * puts the instance into 'Rework'. The requester corrects the
 * business object and calls ResubmitWorkflow (R3 path).
 */
async function sendBackTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task, instance } = loaded;

  await assertTaskAccess(req, tx, task);
  if (req.errors?.length) return;

  if (task.status !== "Open") {
    return req.error(400, `Task is '${task.status}'; only open tasks can be sent back.`);
  }

  const comments = req.data?.comments;
  if (!comments || !comments.trim()) {
    return req.error(400, "Comments are mandatory when sending a task back for rework.");
  }

  const me = actorId(req);

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({
        status: "Rejected",
        decision: "Rejected",
        decidedOn: now(),
        decisionBy_ID: me,
        decidedVia: "Direct",
        comments,
      })
      .where({ ID: task.ID }),
  );

  const openTasks = await tx.run(
    SELECT.from(TASK_ENTITY).where({ instance_ID: instance.ID, status: "Open" }),
  );
  for (const t of openTasks) {
    await tx.run(UPDATE(TASK_ENTITY).set({ status: "Skipped" }).where({ ID: t.ID }));
  }

  const before = instance.status;
  await tx.run(
    UPDATE(INSTANCE_ENTITY).set({ status: "Rework" }).where({ ID: instance.ID }),
  );

  await writeHistory(tx, instance, {
    action: "SendBack",
    stepNumber: task.currentStepNumber,
    taskId: task.ID,
    previousStatus: before,
    newStatus: "Rework",
    actorId: me,
    comments,
  });

  // Module hook: return the business object to editable state.
  const callbacks = getCallbacks(instance.businessObjectType);
  if (callbacks.applyRework) {
    await callbacks.applyRework(tx, instance, comments);
  }

  return `Task sent back to the requester for rework. The workflow is now in Rework.`;
}

/**
 * Reassign: permanently hand the OPEN task to another employee.
 * Allowed for managers / HR / SystemAdmin (per @restrict).
 */
async function reassignTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task, instance } = loaded;

  if (task.status !== "Open") {
    return req.error(400, `Task is '${task.status}'; only open tasks can be reassigned.`);
  }

  const newAssignee = req.data?.newAssignee_ID;
  if (!newAssignee) return req.error(400, "newAssignee_ID is required.");

  const target = await tx.run(
    SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: newAssignee }),
  );
  if (!target) return req.error(404, "Target employee for reassignment does not exist.");

  if (
    newAssignee === instance.requester_ID &&
    !instance.definition.allowSelfApproval
  ) {
    return req.error(400, "Cannot reassign a task to the requester (self-approval rule).");
  }

  const me = actorId(req);

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({ assigneeEmployee_ID: newAssignee, assigneeType: "Position" })
      .where({ ID: task.ID }),
  );

  await writeHistory(tx, instance, {
    action: "Reassigned",
    stepNumber: task.currentStepNumber,
    taskId: task.ID,
    actorId: me,
    comments:
      req.data?.comments ||
      `Task reassigned from ${task.assigneeEmployee_ID || "role queue"} to ${target.firstName} ${target.lastName}.`,
  });

  return `Task reassigned to ${target.firstName} ${target.lastName}.`;
}

/**
 * Delegate: let someone else act on THIS task for me. The task
 * keeps the original assignee (audit trail) but records the
 * delegate, who gains action rights via assertTaskAccess; their
 * decision is stored with decidedVia 'Delegation'.
 */
async function delegateTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task, instance } = loaded;

  // Only the current actor chain (assignee or existing delegate)
  // may extend the delegation chain.
  await assertTaskAccess(req, tx, task);
  if (req.errors?.length) return;

  if (task.status !== "Open") {
    return req.error(400, `Task is '${task.status}'; only open tasks can be delegated.`);
  }

  const delegateId = req.data?.delegate_ID;
  if (!delegateId) return req.error(400, "delegate_ID is required.");

  const delegate = await tx.run(
    SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: delegateId }),
  );
  if (!delegate) return req.error(404, "Delegate employee does not exist.");

  if (
    delegateId === instance.requester_ID &&
    !instance.definition.allowSelfApproval
  ) {
    return req.error(400, "Cannot delegate a task to the requester (self-approval rule).");
  }

  const me = actorId(req);

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({ decisionBy_ID: delegateId })
      .where({ ID: task.ID }),
  );

  await writeHistory(tx, instance, {
    action: "Delegated",
    stepNumber: task.currentStepNumber,
    taskId: task.ID,
    actorId: me,
    comments:
      req.data?.comments ||
      `Task delegated to ${delegate.firstName} ${delegate.lastName}.`,
  });

  return `Task delegated to ${delegate.firstName} ${delegate.lastName}. They can now approve or reject it on your behalf.`;
}

/**
 * Escalate: HR moves an OPEN task (e.g. overdue or approver
 * unavailable) to the department HR representative.
 */
async function escalateTask(req) {
  const tx = cds.transaction(req);
  const loaded = await loadTaskForAction(req, tx);
  if (!loaded) return;
  const { task } = loaded;

  if (task.status !== "Open") {
    return req.error(400, `Task is '${task.status}'; only open tasks can be escalated.`);
  }

  const hr = await findDepartmentHR(tx);
  if (!hr) {
    return req.error(404, "No active Department HR representative found to escalate to.");
  }

  const me = actorId(req);

  await tx.run(
    UPDATE(TASK_ENTITY)
      .set({ assigneeEmployee_ID: hr.ID, assigneeType: "LevelHR" })
      .where({ ID: task.ID }),
  );

  await writeHistory(tx, { ID: task.instance_ID }, {
    action: "Escalated",
    stepNumber: task.currentStepNumber,
    taskId: task.ID,
    actorId: me,
    comments:
      req.data?.comments ||
      `Task escalated to HR representative ${hr.firstName} ${hr.lastName}.`,
  });

  return `Task escalated to ${hr.firstName} ${hr.lastName} (Department HR).`;
}

// ============================================================
// INSTANCE ACTIONS: Cancel + Resubmit
// ============================================================

/**
 * Cancel a Running/Rework instance. Allowed for the requester or
 * HR/SystemAdmin (R2: finalized instances cannot be cancelled).
 */
async function cancelInstance(req) {
  const tx = cds.transaction(req);
  const instanceId = req.params?.[0]?.ID || req.params?.[0];
  if (!instanceId) return req.error(400, "Instance identifier missing.");

  const instance = await loadInstanceLean(tx, instanceId);
  if (!instance) return req.error(404, "Workflow instance not found.");

  const me = actorId(req);
  const isRequester = !!me && me === instance.requester_ID;
  const isHrOrAdmin = auth.hasRole(req, "HRExecutive", "HRAdmin");

  if (!isRequester && !isHrOrAdmin) {
    return req.error(403, "Only the requester or HR/SystemAdmin can cancel a workflow.");
  }

  if (instance.status !== "Running" && instance.status !== "Rework") {
    return req.error(
      400,
      `Workflow instance is '${instance.status}' and can no longer be cancelled.`,
    );
  }

  return finalizeInstance(req, tx, instance, "Cancelled", req.data?.comments, null);
}

/**
 * Resubmit after Rework (the R3 resubmission path): only the
 * requester, only from 'Rework'; reopens step 1 on the SAME
 * instance so history stays in one place.
 */
async function resubmitWorkflow(req) {
  const tx = cds.transaction(req);
  const instanceId = req.params?.[0]?.ID || req.params?.[0];
  if (!instanceId) return req.error(400, "Instance identifier missing.");

  const instance = await loadInstanceLean(tx, instanceId);
  if (!instance) return req.error(404, "Workflow instance not found.");

  const me = actorId(req);
  if (!me || me !== instance.requester_ID) {
    return req.error(403, "Only the requester can resubmit this workflow.");
  }

  if (instance.status !== "Rework") {
    return req.error(
      400,
      `Only workflows in 'Rework' can be resubmitted (current: '${instance.status}').`,
    );
  }

  const definition = instance.definition;
  const before = instance.status;

  const result = await openStep(req, tx, instance, definition, 1, before);
  if (result !== undefined) {
    await refreshCurrentStep(tx, instance.ID, 1);
  }

  await tx.run(
    UPDATE(INSTANCE_ENTITY).set({ status: "Running" }).where({ ID: instance.ID }),
  );

  await writeHistory(tx, instance, {
    action: "Resubmitted",
    previousStatus: before,
    newStatus: "Running",
    actorId: me,
    comments: "Requester resubmitted the workflow after rework.",
  });

  const callbacks = getCallbacks(instance.businessObjectType);
  if (callbacks.applyResubmit) {
    await callbacks.applyResubmit(tx, instance);
  }

  return "Workflow resubmitted. Step 1 tasks reopened for the approvers.";
}

// ============================================================
// START WORKFLOW (unbound action used by business modules)
// ============================================================

/**
 * Starts a workflow for a business object.
 *
 * `overrides` allows BOUND module actions (e.g. Leave's
 * StartWorkflow on LeaveRequests) to pass the business object and
 * requester explicitly; the unbound generic action reads them
 * from req.data.
 */
async function startWorkflow(req, overrides = {}) {
  const tx = cds.transaction(req);

  const businessObjectType = overrides.businessObjectType || req.data.businessObjectType;
  const businessObjectId = overrides.businessObjectId || req.data.businessObjectId;
  const summary = overrides.summary ?? req.data.summary;

  if (!businessObjectType || !businessObjectId) {
    return req.error(400, "businessObjectType and businessObjectId are required.");
  }

  const requesterId = overrides.requesterId || req.data.requester_ID || req.user?.attr?.employeeId;
  if (!requesterId) {
    return req.error(400, "Cannot determine the requester employee for this workflow.");
  }

  // R1: pick the ACTIVE definition matching the business object.
  const definition = await tx.run(
    SELECT.one.from(DEFINITION_ENTITY).where({
      businessObjectType,
      status: "Active",
    }),
  );
  if (!definition) {
    return req.error(
      404,
      `No active workflow definition configured for '${businessObjectType}'.`,
    );
  }

  // One ACTIVE journey per business object: refuse a second
  // start while an instance is Running or waiting in Rework
  // (Rework instances are continued via ResubmitWorkflow).
  const openInstance = await tx.run(
    SELECT.one.from(INSTANCE_ENTITY).where({
      businessObjectType,
      businessObjectId,
      status: { in: ["Running", "Rework"] },
    }),
  );
  if (openInstance) {
    return req.error(
      409,
      `This business object already has a workflow instance in '${openInstance.status}' status. Use ResubmitWorkflow for rework.`,
    );
  }

  // Business object must really exist.
  const businessRow = await tx.run(
    SELECT.one.from(businessObjectType).where({ ID: businessObjectId }),
  );
  if (!businessRow) {
    return req.error(404, `Business object '${businessObjectId}' does not exist.`);
  }

  const instanceId = cds.utils.uuid();
  await tx.run(
    INSERT.into(INSTANCE_ENTITY).entries({
      ID: instanceId,
      businessObjectType,
      businessObjectId,
      definition_ID: definition.ID,
      requester_ID: requesterId,
      status: "Running",
      summary: summary || null,
    }),
  );

  const instance = { ID: instanceId, requester_ID: requesterId, businessObjectType, status: "Running" };

  await writeHistory(tx, instance, {
    action: "Submitted",
    previousStatus: null,
    newStatus: "Running",
    actorId: requesterId,
    comments: summary || `Workflow ${definition.name} started.`,
  });

  const result = await openStep(req, tx, instance, definition, 1);
  if (result !== undefined) {
    await refreshCurrentStep(tx, instanceId, 1);
  }

  return `Workflow ${definition.definitionCode} started for ${businessObjectType} ${businessObjectId}.`;
}

// ============================================================
// REGISTRATION HELPERS (used by the service implementation)
// ============================================================

function registerWorkflowActions(srv) {
  const tasks = srv.entities.WorkflowTasks;
  const instances = srv.entities.WorkflowInstances;

  srv.on("Approve", tasks, approveTask);
  srv.on("Reject", tasks, rejectTask);
  srv.on("SendBack", tasks, sendBackTask);
  srv.on("Reassign", tasks, reassignTask);
  srv.on("Delegate", tasks, delegateTask);
  srv.on("EscalateTask", tasks, escalateTask);
  srv.on("CancelWorkflow", instances, cancelInstance);
  srv.on("ResubmitWorkflow", instances, resubmitWorkflow);
}

// ============================================================
// INTEGRITY GUARDS (history immutability, engine-only writes)
// ============================================================

function registerGuards(srv) {
  // R6: history is append-only.
  srv.before("UPDATE", "WorkflowHistories", (req) =>
    req.error(400, "Compliance violation: workflow history is immutable and cannot be modified."),
  );
  srv.before("DELETE", "WorkflowHistories", (req) =>
    req.error(400, "Compliance violation: workflow history cannot be deleted."),
  );

  // Instances/tasks only ever created by the engine.
  srv.before("CREATE", "WorkflowInstances", (req) =>
    req.error(400, "Workflow instances are created only via the StartWorkflow action."),
  );
  srv.before("CREATE", "WorkflowTasks", (req) =>
    req.error(400, "Workflow tasks are created only by the workflow engine."),
  );

  // Instance status only via actions; instances are never deleted.
  srv.before("UPDATE", "WorkflowInstances", (req) => {
    if ("status" in (req.data || {})) {
      return req.error(
        400,
        "Instance status changes must go through workflow actions (CancelWorkflow).",
      );
    }
  });
  srv.before("DELETE", "WorkflowInstances", (req) =>
    req.error(400, "Workflow instances cannot be deleted. Cancel them instead."),
  );

  // Task decisions only via actions; tasks are never deleted.
  srv.before("UPDATE", "WorkflowTasks", (req) => {
    const forbidden = [
      "status", "decision", "decidedOn", "decisionBy_ID",
      "currentStepNumber", "instance_ID",
    ];
    for (const f of forbidden) {
      if (f in (req.data || {})) {
        return req.error(
          400,
          `Field '${f}' is controlled by the workflow engine. Use the task actions instead.`,
        );
      }
    }
  });
  srv.before("DELETE", "WorkflowTasks", (req) =>
    req.error(400, "Workflow tasks cannot be deleted."),
  );

  // Delegation validations live in handlers/delegations.js
  // (ownership, date ranges, delegate existence).
}

module.exports = {
  startWorkflow,
  approveTask,
  rejectTask,
  sendBackTask,
  reassignTask,
  delegateTask,
  escalateTask,
  cancelInstance,
  resubmitWorkflow,
  registerWorkflowActions,
  registerGuards,
  writeHistory,
  loadInstanceLean,
  openStep,
  completeInstance,
  finalizeInstance,
  assertTaskAccess,
};
