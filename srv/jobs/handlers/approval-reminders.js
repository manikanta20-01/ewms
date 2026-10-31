const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { alreadyNotified } = require("../../compliance/handlers/compliance-rules");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 24 - WORKFLOW APPROVAL REMINDER JOB
// ------------------------------------------------------------
// Reminds the resolved human approver about OPEN workflow tasks
// that are due soon or already overdue.
//
// Beginner summary of the rules:
//   * Source of truth = the workflow ENGINE's own WorkflowTask
//     rows (status 'Open'). The job never interprets approval
//     logic: no escalation, no auto-skip, no status change - it
//     only REMINDS. Business decisions stay with the approver.
//   * Only tasks resolved to a PERSON can be reminded. Tasks for
//     Role-based steps (assigneeEmployee_ID is null) have no
//     single recipient -> skipped, not invented.
//   * Reminder states (mutually exclusive):
//       overdue   - task dueDate < asOfDate
//       due soon  - dueDate within [asOfDate, asOfDate + window]
//   * One reminder per task and per state, ever (dedupe on
//     recipient + title + task ID). Re-runs and retries are safe.
//   * The reminder text contains task name, step number and due
//     date ONLY - no business object content (privacy).
// ============================================================

const TASK_ENTITY = "ewms.db.workflow.WorkflowTask";

// Notification vocabulary (enums.NotificationCategory is a plain
// string enum in the DB, WORKFLOW exists).
const CATEGORY = "WORKFLOW";
const TITLE_OVERDUE = "Overdue approval task";
const TITLE_DUE_SOON = "Approval task due soon";

let LOG;
function logger() {
  if (!LOG) LOG = cds.log("jobs/approval-reminders");
  return LOG;
}

async function run(tx, { window: windowInput, now, maxRows }) {
  const daysBefore = Number(windowInput);
  const win = Number.isInteger(daysBefore) && daysBefore > 0 ? daysBefore : 7;
  const asOf = now || new Date().toISOString().slice(0, 10);

  const tasks = await tx.run(
    SELECT.from(TASK_ENTITY)
      .columns("ID", "stepName", "currentStepNumber", "dueDate", "assigneeEmployee_ID")
      .where({ status: "Open" })
      .limit(maxRows || 500),
  );

  let sent = 0;
  let scanned = 0;

  for (const task of tasks || []) {
    scanned += 1;

    // No resolved person -> cannot remind anybody. Skipped, never
    // invented (documented decision).
    if (!task.assigneeEmployee_ID) continue;

    // Unbounded tasks (slaDays not configured -> dueDate null)
    // have no fair reminder point -> skipped.
    const due = task.dueDate ? String(task.dueDate).slice(0, 10) : null;
    if (!due) continue;

    const overdue = due < asOf;
    const dueSoon = !overdue && due <= addDays(asOf, win);
    if (!overdue && !dueSoon) continue;

    const title = overdue ? TITLE_OVERDUE : TITLE_DUE_SOON;

    if (await alreadyNotified(tx, { recipientId: task.assigneeEmployee_ID, title, sourceRecordId: task.ID })) {
      continue;
    }

    const ok = await notify(tx, {
      recipientId: task.assigneeEmployee_ID,
      title,
      message: overdue
        ? `Approval task "${task.stepName || "Task"}" (step ${task.currentStepNumber}) has been overdue since ${due}. Please decide.`
        : `Approval task "${task.stepName || "Task"}" (step ${task.currentStepNumber}) is due on ${due}. Please decide.`,
      category: CATEGORY,
      priority: overdue ? "High" : "Medium",
      sourceModule: "WORKFLOW",
      sourceEntity: TASK_ENTITY,
      sourceRecordId: task.ID,
    });
    // notify() swallows-and-logs its own failures; a detected skip
    // must not silently count as sent (accurate results).
    if (ok) sent += 1;
    else logger().warn(`Reminder for task ${task.ID} could not be persisted.`);
  }

  return { reminders: sent, tasksScanned: scanned, windowDays: win, asOf };
}

function addDays(isoDate, days) {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = { run, TASK_ENTITY };
