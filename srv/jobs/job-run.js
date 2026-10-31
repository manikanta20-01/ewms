// ============================================================
// SPRINT 24 - JOB EXECUTION ENGINE ("WITHOUT A JOB TABLE")
// ------------------------------------------------------------
// Design decision (documented in SPRINT-24.md):
//   * REMINDER IDEMPOTENCY  - lives in the notification table
//     itself (dedupe on recipient + title + business record ID,
//     via compliance-rules.alreadyNotified). A re-run of a job
//     cannot create duplicate notifications, because the RIGHT
//     place already stores who was reminded about what.
//   * EXECUTION HISTORY     - a bounded IN-MEMORY list (latest 50
//     runs, cleared on restart) exposed to admins through the
//     JobsService. No database entity was added for cosmetic
//     logging. Production note: durable history would need a
//     table or an observability sink - deliberately deferred.
//   * OVERLAP PREVENTION    - an in-process guard (one job may
//     not run twice at the same time IN THIS PROCESS). This is a
//     SINGLE-INSTANCE assumption, documented honestly: two app
//     instances could run the same job concurrently. For the
//     HANA deployment target the reminder dedupe still makes
//     repeats harmless, but true multi-instance safety needs
//     real distributed locking (production requirement, later).
//
// The SAME engine runs from three entry points:
//   * HTTP action     -> srv/jobs/jobs-service.js (SystemAdmin)
//   * CLI             -> srv/jobs/run-job.js
//   * scheduler timer -> srv/jobs/scheduler.js (env-gated, OFF
//                        by default, never active in tests)
// ============================================================

const cds = require("@sap/cds");

const registry = require("./registry");
const { MAX_ROWS_PER_JOB_RUN } = registry;

const LOG = cds.log("jobs");

/** Same ISO-YYYY-MM-DD shape every EWMS module uses for dates. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------
// OVERLAP GUARD (in-process)
// ------------------------------------------------------------
const inFlight = new Map(); // job name -> Promise of the running execution

// ------------------------------------------------------------
// BOUNDED IN-MEMORY EXECUTION HISTORY
// (cleared on restart; admin-visible via JobsService.JobRuns)
// ------------------------------------------------------------
const HISTORY_LIMIT = 50;
const history = [];
let runCounter = 0;

function recordHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

/** JobRuns entity READ handler (admin-only, newest first). */
function getHistory() {
  return history.map((h) => ({
    ...h,
    // Never expose raw error text to readers (it could contain SQL
    // fragments or file paths; the sanitized summary stays).
    error: undefined,
  }));
}

// ------------------------------------------------------------
// PARAMETER VALIDATION (shared by every entry point)
// ------------------------------------------------------------
function validateOptions(jobName, opts = {}) {
  if (!registry.isKnownJob(jobName)) {
    return `Unknown job '${jobName ?? ""}'. Supported jobs: ${registry.allJobNames().join(", ")}.`;
  }

  // Optional simulation date ("as of"). Must be a real ISO date,
  // never in the future (a future clock would fabricate overdue
  // business states and spam reminders), not too far in the past
  // (an accidental historic backfill would create a flood of
  // reminders against old data).
  if (opts.asOfDate != null) {
    if (!ISO_DATE.test(String(opts.asOfDate))) {
      return "asOfDate must be an ISO date (YYYY-MM-DD).";
    }
    const serverToday = new Date().toISOString().slice(0, 10);
    // ~5 years back is plenty for a wide local test window while
    // still refusing absurd backfills.
    const minDate = "2020-01-01";
    if (String(opts.asOfDate) < minDate) {
      return `asOfDate may not be earlier than ${minDate}.`;
    }
    if (String(opts.asOfDate) > serverToday) {
      return "asOfDate may not be in the future.";
    }
  }

  if (opts.windowDays != null) {
    const n = Number(opts.windowDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return "windowDays must be a whole number between 1 and 365.";
    }
    const def = registry.JOBS[jobName];
    if (!def.acceptsWindowDays && opts.windowDays != null) {
      return `Job '${jobName}' does not accept windowDays.`;
    }
  }

  return null; // valid
}

// ------------------------------------------------------------
// EXECUTION
// ------------------------------------------------------------
/**
 * Runs ONE job with overlap prevention, accurate status reporting
 * and bounded history. The engine owns the transaction via the
 * CAP callback form (see the comment inside).
 *
 * @param txOrService  CAP service (e.g. the db service) whose tx
 *                     callback executes the job; falls back to cds.db.
 * @returns { runId, job, status: 'ok'|'failed', ...counts }
 */
async function executeJob(txOrService, jobName, opts = {}) {
  const job = registry.JOBS[jobName];
  const validationError = validateOptions(jobName, opts);
  if (validationError) {
    const e = new Error(validationError);
    e.status = 400;
    throw e;
  }

  // --------
  // Overlap guard: the SAME job may not start while it is
  // already running in this process. The guard throws 409 -
  // an accurate, restart-friendly answer.
  // --------
  if (inFlight.has(jobName)) {
    const e = new Error(`Job '${jobName}' is already running. Wait for it to finish.`);
    e.status = 409;
    throw e;
  }
  const runId = `run-${Date.now()}-${(runCounter += 1)}`;
  const startedAt = new Date().toISOString();

  const execution = (async () => {
    let result;
    let status = "ok";
    let summary = "";

    // The ENGINE owns one transaction-per-run via CAP's documented
    // owner.tx(fn) callback form: CAP BEGINS the transaction, runs
    // the function, COMMITs when it resolves and ROLLBACKs when it
    // throws - no half-reminded batch is ever left behind, and the
    // transaction/connection is always closed when the pass ends.
    // (A manual begin/commit mis-links with nested transactions
    // created by the shared notify() helper - the callback form is
    // the pattern CAP itself guarantees.)
    const owner = txOrService ?? cds.db;
    try {
      result = await owner.tx(async (tx) => {
        const runResult = await job.run(tx, {
          window: opts.windowDays,
          now: opts.asOfDate || undefined,
          maxRows: MAX_ROWS_PER_JOB_RUN,
        });
        // One flat, safe summary (counts only - no row payloads).
        summary = JSON.stringify(runResult ?? {});
        return runResult;
      });
    } catch (err) {
      status = "failed";
      result = undefined;
      summary = sanitizeError(err);
      LOG.error(`Job '${jobName}' failed:`, summary);
      throw err;
    } finally {
      recordHistory({
        runId,
        job: jobName,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        summary,
      });
      inFlight.delete(jobName);
    }
    return { runId, job: jobName, status: "ok", ...result, summary };
  })();

  inFlight.set(jobName, execution);

  // Mark the promise chain handled so an error NEVER becomes an
  // unhandled rejection, even when a scheduler tick doesn't await
  // the run (the caller still gets the original error).
  execution.catch(() => {});

  // Self-healing cleanup even if the caller never awaits.
  // IMPORTANT: `.finally()` returns a NEW promise that re-throws
  // the execution error -- if that derived promise is left
  // unnattended, Node treats the rejection as fatal and KILLS the
  // whole server (reproduced as a real crash: a failed RunJob
  // 500'd correctly, then the process died ~1 s later). We keep
  // a handle on the cleanup chain and swallow it here; the CALLER
  // still receives the original error from `execution` itself.
  const cleanup = execution
    .catch(() => {})
    .finally(() => {
      inFlight.delete(jobName);
    });
  cleanup.catch(() => {});

  return execution;
}

/** Truncate + flatten an error so it is safe for logs. */
function sanitizeError(err) {
  const msg = String(err?.message || err || "unknown error").replace(/\s+/g, " ").slice(0, 200);
  return msg;
}

/** Are any jobs currently running? (used by tests + shutdown) */
function runningJobs() {
  return Array.from(inFlight.keys());
}

module.exports = {
  executeJob,
  validateOptions,
  getHistory,
  runningJobs,
  MAX_ROWS_PER_JOB_RUN,
  ISO_DATE,
};
