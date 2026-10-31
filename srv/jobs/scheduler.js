const cds = require("@sap/cds");

// ============================================================
// SPRINT 24 - OPTIONAL IN-PROCESS SCHEDULER (ENV-GATED, DEFAULT OFF)
// ------------------------------------------------------------
// Beginner summary:
//
//   * NOTHING starts a timer by default. The scheduler is active
//     ONLY when BOTH are true:
//         EWMS_JOBS_ENABLED = "true"      AND
//         CDS_ENV is not "test"           (unit/integration tests
//           and NODE_ENV is not "test"     must never hang because
//                                           of recurring timers)
//   * Interval: EWMS_JOBS_INTERVAL (minutes, default 60, min 5).
//   * Every tick re-uses the SAME validated path as the service
//     action and CLI (job-run.executeJob), so:
//         - invalid config is logged and refused,
//         - a running job is never started twice (overlap guard),
//         - failures are logged, never thrown into the server
//           event loop (one failing job cannot crash the app),
//         - summaries go to structured cds.log only.
//   * The timer is unref()'d so a clean process shutdown is not
//     blocked, and the handle is closed on cds shutdown.
//   * SINGLE-INSTANCE assumption: this schedules only THIS
//     process. Multi-instance production deployments need a
//     real scheduler (job scheduler service / cron + one worker)
//     - documented in SPRINT-24.md, deliberately not invented.
// ============================================================

const LOG = cds.log("jobs/scheduler");

const DEFAULT_INTERVAL_MIN = 60;
const MIN_INTERVAL_MIN = 5;

function schedulerEnabled() {
  if (process.env.EWMS_JOBS_ENABLED !== "true") return false;
  // Tests must never have recurring timers running.
  if (process.env.CDS_ENV === "test" || process.env.NODE_ENV === "test") return false;
  return true;
}

function intervalMinutes() {
  const n = Number(process.env.EWMS_JOBS_INTERVAL);
  if (!Number.isFinite(n) || n < MIN_INTERVAL_MIN) return DEFAULT_INTERVAL_MIN;
  return Math.floor(n);
}

let timer = null;

function start() {
  if (!schedulerEnabled()) return null;
  if (timer) return timer; // already running (hot reload safety)

  // Lazy require avoids a cycle with job-run.js at module load.
  const { executeJob, validateOptions, runningJobs } = require("./job-run");

  const minutes = intervalMinutes();
  LOG.info(`Background scheduler enabled: interval ${minutes} min, jobs: ${require("./registry").allJobNames().join(", ")}`);

  timer = setInterval(async () => {
    if (runningJobs().length > 0) {
      // Never stack up tick executions behind a slow previous pass.
      LOG.warn(`Tick skipped - jobs still running: ${runningJobs().join(", ")}`);
      return;
    }
    for (const jobName of require("./registry").allJobNames()) {
      if (validateOptions(jobName, {})) {
        LOG.warn(`Scheduler skipping misconfigured job '${jobName}': ${validateOptions(jobName, {})}`);
        continue;
      }
      try {
        // Each tick gets its OWN transaction - a failed tick never
        // leaves a poisoned transaction behind.
        await executeJob(cds.db, jobName, {});
      } catch (err) {
        // Logged inside executeJob; the loop continues.
      }
    }
  }, minutes * 60 * 1000);

  // Do not keep the Node event loop alive just for the scheduler.
  timer.unref();

  cds.on("shutdown", () => stop());
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    LOG.info("Background scheduler stopped.");
  }
}

module.exports = { start, stop, schedulerEnabled };
