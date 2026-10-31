#!/usr/bin/env node
// ============================================================
// SPRINT 24 - LOCAL CLI FOR ONE BACKGROUND JOB RUN
// ------------------------------------------------------------
// Runs ONE registered job against the project's configured
// database (whatever cds.connect would give this process) and
// prints a flat, safe summary to stdout. No HTTP, no scheduler.
//
// Usage (from the project root):
//
//     CDS_ENV=test node srv/jobs/run-job.js document-expiry \
//         --window 30 --as-of 2026-10-22     (throws simulation)
//
//     node srv/jobs/run-job.js workflow-approvals --window 7
//     node srv/jobs/run-job.js timesheet-drafts
//
// Notes
//   * With CDS_ENV=test this executes against the isolated
//     in-memory SQLite profile - perfect for a harmless smoke
//     run of the pipeline.
//   * WITHOUT an env override the command uses the normal local
//     profile, i.e. your DEVELOPMENT db.sqlite - it writes real
//     reminder rows there (deduped, so re-running is safe).
//   * Exit codes: 0 ok, 1 unknown/misconfigured job, 2 failed run.
// ============================================================

const cds = require("@sap/cds");

function parseArgs(argv) {
  const out = { jobName: argv[0], windowDays: undefined, asOfDate: undefined };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--window") out.windowDays = Number(argv[++i]);
    else if (a === "--as-of") out.asOfDate = argv[++i];
  }
  return out;
}

(async () => {
  const { jobName, windowDays, asOfDate } = parseArgs(process.argv.slice(2));
  // parseArgs keys above are camelCase; align with executeJob opts.
  const opts = { windowDays, asOfDate };

  if (!jobName) {
    console.error("Usage: node srv/jobs/run-job.js <job> [--window N] [--as-of YYYY-MM-DD]");
    process.exit(1);
  }

  const { validateOptions } = require("./job-run");
  const invalid = validateOptions(jobName, opts);
  if (invalid) {
    console.error(`Invalid job or parameters: ${invalid}`);
    process.exit(1);
  }

  try {
    // Standalone CAP usage: connecting to the db service triggers
    // model loading from the project roots (db/, srv/) - no server
    // needs to be started for a one-shot run.
    const db = await cds.connect.to("db");

    // DEMO-CRITICAL SAFETY RULE: for an in-memory database (the
    // CDS_ENV=test profile) there is nothing on disk that a
    // drop-create deploy could damage - deploy it so the run has
    // schema + seed data. For a FILE database (e.g. the local dev
    // db.sqlite) we NEVER deploy here: `cds deploy` performs a
    // DROP-CREATE, which would wipe dev business data. A fresh
    // file database must be populated once with the standard
    // `npx cds deploy` command - documented in SPRINT-24.md.
    const url = db.options?.credentials?.url || db.options?.credentials?.database || "";
    if (url.includes(":memory:")) {
      const csn = await cds.load("*").then(cds.compile);
      await cds.deploy(csn).to(db, { silent: true });
    }
    const { executeJob } = require("./job-run");

    const result = await executeJob(db, jobName, opts);
    const { summary: _engineSummary, ...flatCounts } = result;
    console.log(JSON.stringify({ job: jobName, status: result.status, ...flatCounts }, null, 2));
    process.exit(0);
  } catch (err) {
    const msg = String(err?.message || err).replace(/\s+/g, " ").slice(0, 200);
    if (err?.status === 409) {
      console.error(`Job is already running (409): ${msg}`);
      process.exit(2);
    }
    console.error(`Job failed: ${msg}`);
    process.exit(2);
  }
})();
