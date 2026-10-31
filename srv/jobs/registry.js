// ============================================================
// SPRINT 24 - JOB REGISTRY (WHICH JOBS EXIST, AND THEIR LIMITS)
// ------------------------------------------------------------
// Beginner summary:
//
//   * This file is the single list of SUPPORTED background jobs.
//     A job is registered here ONLY when its business logic is
//     already implemented in a business module - the job layer
//     COORDINATES (when/how often to run) and NEVER re-implements
//     the business rules themselves.
//
//   * Every job defines:
//       - a stable `name` (used by the CLI, the service action
//         and the scheduler),
//       - which module implements it (documented for maintainers),
//       - a parameter validator,
//       - its run function (async, receives a tx + options).
//
//   * Adding a new job later = add one entry here + one handler
//     module. Nothing else in the layer needs to change.
// ============================================================

const { sendDocumentExpiryReminders } = require("../compliance/handlers/compliance-rules");
const approvalReminders = require("./handlers/approval-reminders");
const timesheetDraftReminders = require("./handlers/timesheet-draft-reminders");

/** Hard ceiling of rows ANY job may process in one pass. Keeps
 *  every run bounded no matter how large the local database grows. */
const MAX_ROWS_PER_JOB_RUN = 500;

const JOBS = {
  // ------------------------------------------------------------
  // Reuses the EXACT reminder rules of the Sprint 17 compliance
  // module (sendDocumentExpiryReminders is the very function the
  // manual action NotifyDocumentExpiries also calls - one rule
  // set, two entry points).
  // ------------------------------------------------------------
  "document-expiry": {
    description:
      "Remind employees about expiring/expired verified documents and missing mandatory requirement documents (rules owned by the compliance module).",
    acceptsWindowDays: true, // window between 1..365 days before expiry
    run: (tx, opts) => sendDocumentExpiryReminders(tx, opts),
  },

  "workflow-approvals": {
    description:
      "Remind the assigned approver about open workflow tasks that are due soon or overdue (rules owned by the workflow engine's task data).",
    acceptsWindowDays: true,
    run: (tx, opts) => approvalReminders.run(tx, opts),
  },

  "timesheet-drafts": {
    description:
      "Remind employees about timesheets that are still Draft even though the reporting period has fully ended (rules owned by the timesheet module).",
    acceptsWindowDays: false,
    run: (tx, opts) => timesheetDraftReminders.run(tx, opts),
  },
};

function isKnownJob(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(JOBS, name);
}

function allJobNames() {
  return Object.keys(JOBS);
}

module.exports = {
  JOBS,
  MAX_ROWS_PER_JOB_RUN,
  isKnownJob,
  allJobNames,
};
