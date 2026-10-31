const cds = require("@sap/cds");
const { executeJob, validateOptions, getHistory, MAX_ROWS_PER_JOB_RUN } = require("./job-run");
const { allJobNames, isKnownJob } = require("./registry");

// ============================================================
// SPRINT 24 - JOB SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// The HTTP face of the job engine. Everything real (validation,
// overlap guards, history, error sanitizing) lives in job-run.js
// so the scheduler and the CLI execute EXACTLY the same code
// path as this action. Authorization is enforced twice:
//   1. service-declared @(requires:'SystemAdmin') in
//      jobs-service.cds,
//   2. an explicit re-check in the handler (defense in depth,
//      the same pattern other EWMS modules use).
// ============================================================

module.exports = cds.service.impl(async function () {
  const db = await cds.connect.to("db");

  this.on("RunJob", async (req) => {
    // Defense in depth on top of the service-level @requires.
    if (!isSystemAdmin(req)) {
      return req.reject(403, "Job execution is SystemAdmin-only.");
    }

    const { job: jobName, windowDays, asOfDate } = req.data || {};

    if (!isKnownJob(jobName)) {
      return req.reject(400, `Unknown job '${jobName ?? ""}'. Supported jobs: ${allJobNames().join(", ")}.`);
    }

    // Clear 400s for bad parameters (never "empty result and
    // pretend everything ran").
    const err = validateOptions(jobName, { windowDays, asOfDate });
    if (err) return req.reject(400, err);

    try {
      const result = await executeJob(db, jobName, { windowDays, asOfDate });
      // Report plain, safe facts only (counts; no row payloads).
      return `Job '${jobName}' finished: ${JSON.stringify({
        job: result.job,
        status: result.status,
        reminders: result.reminders,
        docReminders: result.docReminders,
        missingReminders: result.missingReminders,
        tasksScanned: result.tasksScanned,
        sheetsScanned: result.sheetsScanned,
        documentsScanned: result.documentsScanned,
        employeesScanned: result.employeesScanned,
        windowDays: result.windowDays,
        asOf: result.asOf,
      })}`;
    } catch (e) {
      if (e.status === 409) {
        return req.reject(409, `Job '${jobName}' is already running. Wait for it to finish.`);
      }
      if (e.status === 400) {
        return req.reject(400, e.message);
      }
      // NEVER leak internals (SQL, paths, stack traces) to callers.
      req.log?.error?.(`RunJob('${jobName}') failed: ${e.message}`);
      return req.reject(500, "Background job failed. Check the server log.");
    }
  });

  // ------------------------------------------------------------
  // JobRuns - bounded in-memory history (admin-only, no secrets:
  // summaries hold counts and a sanitized error line at most).
  // ------------------------------------------------------------
  this.on("READ", this.entities.JobRuns, async () => getHistory());

  // Small helper kept near the file top for readability.
  function isSystemAdmin(req) {
    return !!req.user && req.user.is("SystemAdmin");
  }
});
