const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// ============================================================
// SPRINT 24 - BACKGROUND JOBS (TESTS)
// ------------------------------------------------------------
// All tests run against the standard in-memory CAP test server
// (same pattern as every other suite in this repo) - no live
// server, no HANA, no external notifications, and the optional
// scheduler is provably OFF under CDS_ENV=test.
// ============================================================

const { startTestHarness } = require("./setup");

const { GET, POST } = startTestHarness();

const JOBS_URL = "/odata/v4/jobs";

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } };

async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(code === expectedCode, `expected ${expectedCode} but got ${code} (${err.message})`);
    if (messageMatch) assert.match(String(err.message), messageMatch);
  }
}

/** POST RunJob and return the flat summary STRING. */
async function runJob(payload, user = ADMIN) {
  const res = await POST(`${JOBS_URL}/RunJob`, payload, user);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.value;
}

// ============================================================
// UNIT - parameter validation of the shared engine
// ============================================================
describe("Sprint 24 - job parameter validation", () => {
  const { validateOptions } = require("../srv/jobs/job-run");

  test("unknown job names are rejected", () => {
    assert.ok(/Unknown job/.test(validateOptions("does-not-exist", {})));
    assert.ok(/Unknown job/.test(validateOptions(undefined, {})));
  });

  test("known jobs validate cleanly", () => {
    assert.equal(validateOptions("document-expiry", {}), null);
    assert.equal(validateOptions("workflow-approvals", { windowDays: 30 }), null);
    assert.equal(validateOptions("timesheet-drafts", {}), null);
  });

  test("windowDays bounds", () => {
    assert.ok(/between 1 and 365/.test(validateOptions("workflow-approvals", { windowDays: 0 })));
    assert.ok(/between 1 and 365/.test(validateOptions("workflow-approvals", { windowDays: 366 })));
    assert.ok(/between 1 and 365/.test(validateOptions("workflow-approvals", { windowDays: 2.5 })));
  });

  test("jobs that do not accept windowDays refuse it", () => {
    assert.ok(/does not accept windowDays/.test(validateOptions("timesheet-drafts", { windowDays: 10 })));
  });

  test("asOfDate must be ISO, not future, not absurdly old", () => {
    assert.ok(/ISO date/.test(validateOptions("document-expiry", { asOfDate: "not-a-date" })));
    assert.ok(/future/.test(validateOptions("document-expiry", { asOfDate: "2099-01-01" })));
    assert.ok(/earlier than/.test(validateOptions("document-expiry", { asOfDate: "1999-01-01" })));
    assert.equal(validateOptions("document-expiry", { asOfDate: "2025-06-15" }), null);
  });
});

// ============================================================
// HTTP - authorization and error paths
// ============================================================
describe("Sprint 24 - job service authorization and validation", () => {
  test("plain employee cannot run jobs or read history", async () => {
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "document-expiry" }, JOHN),
      403,
    );
    await expectError(() => GET(`${JOBS_URL}/JobRuns`, JOHN), 403);
  });

  test("HR executive gets 403 - job control is SystemAdmin-only", async () => {
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "document-expiry" }, HR),
      403,
    );
    await expectError(() => GET(`${JOBS_URL}/JobRuns`, HR), 403);
  });

  test("unknown job name -> clear 400", async () => {
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "totally-made-up" }, ADMIN),
      400,
      /Supported jobs/,
    );
  });

  test("invalid parameters -> clear 400", async () => {
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "workflow-approvals", windowDays: 9999 }, ADMIN),
      400,
      /between 1 and 365/,
    );
    // CAP validates the Date type itself at the protocol layer
    // (its message differs); either way the caller gets a 400.
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "document-expiry", asOfDate: "31-12-2030" }, ADMIN),
      400,
      /valid Date|ISO date/,
    );
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "document-expiry", asOfDate: "2099-01-01" }, ADMIN),
      400,
      /future/,
    );
  });

  test("a job that does not accept windowDays -> 400", async () => {
    await expectError(
      () => POST(`${JOBS_URL}/RunJob`, { job: "timesheet-drafts", windowDays: 5 }, ADMIN),
      400,
      /does not accept windowDays/,
    );
  });
});

// ============================================================
// DATA - real execution, accurate results, idempotency
// ============================================================
describe("Sprint 24 - job execution and idempotency", () => {
  test("document-expiry job: reminders for missing mandatory docs, then dedupe", async () => {
    // Wide window: the seeded data has NO verified documents, but
    // several employees lack mandatory requirement docs - the pass
    // must remind about MISSING requirements.
    const summary1 = await runJob({ job: "document-expiry", windowDays: 365 });
    assert.ok(/docReminders/.test(summary1) && /missingReminders".[1-9]/.test(summary1), summary1);
    assert.ok(!/sql|filePath|stack/i.test(summary1), "no internal details in the summary");

    // Immediate re-run: the SAME reminder combination must be
    // suppressed by the dedupe (recipient + title + business ID).
    const summary2 = await runJob({ job: "document-expiry", windowDays: 365 });
    assert.ok(/"missingReminders":0/.test(summary2), `re-run must not duplicate reminders: ${summary2}`);
  });

  test("workflow-approvals job reports success with zero counts", async () => {
    // The seeded workflow tasks are Open but carry no dueDate yet -
    // none is eligible (documented rule: no deadline, no reminder).
    const summary = await runJob({ job: "workflow-approvals", windowDays: 7 });
    assert.ok(/"status":"ok"/.test(summary), summary);
    assert.ok(/"tasksScanned":\d+/.test(summary), summary);
  });

  test("timesheet-drafts job completes safely", async () => {
    const summary = await runJob({ job: "timesheet-drafts" });
    assert.ok(/"status":"ok"/.test(summary), summary);
    assert.ok(/"sheetsScanned":\d+/.test(summary), summary);
  });

  test("JobRuns history records every execution for the admin", async () => {
    // Self-contained: this test first adds one more run, then reads.
    await runJob({ job: "timesheet-drafts" });

    const hist = await GET(`${JOBS_URL}/JobRuns?$top=50`, ADMIN);
    assert.equal(hist.status, 200);
    const rows = hist.data.value || [];
    // document-expiry ran twice + workflow once + timesheet twice
    // at minimum - so at least five executions must be recorded.
    assert.ok(rows.length >= 5, `expected at least 5 recorded runs, got ${rows.length}`);

    for (const row of rows) {
      assert.ok(["ok", "failed"].includes(row.status), `status must be ok/failed, got ${row.status}`);
      assert.ok(row.startedAt && row.finishedAt, "start and finish times recorded");
      // Summaries never contain raw employee payloads or secrets.
      assert.ok(!/"employee_ID"|password/i.test(row.summary), row.summary);
      assert.ok(/document-expiry|workflow-approvals|timesheet-drafts/.test(row.job), row.job);
    }
    // Newest first: the fresh timesheet run must be on top.
    assert.equal(rows[0].job, "timesheet-drafts");
  });
});

// ============================================================
// FAILURE PATH - a failing job must NEVER crash the process
// ------------------------------------------------------------
// Regression for a real, reproduced defect (Phase 2 audit): a
// mid-run database error escaped through the in-flight cleanup
// chain (`.finally()` re-throws into an unattended promise),
// which killed the whole cds-serve process ~1 s AFTER a correct
// 500 response. This test pins two guarantees:
//   1. the caller still receives the error (nothing is hidden),
//   2. NO unhandled rejection escapes (the server survives).
// ============================================================
describe("Sprint 24 - failing job runs never crash the process", () => {
  test("executeJob rejects cleanly without unhandled rejections", async () => {
    const registry = require("../srv/jobs/registry");
    const { executeJob } = require("../srv/jobs/job-run");

    // Capture every unhandled rejection during the test window.
    const escaped = [];
    const onRejection = (reason) => escaped.push(String((reason && reason.message) ?? reason));
    process.on("unhandledRejection", onRejection);

    const originalRun = registry.JOBS["timesheet-drafts"].run;
    try {
      // Deterministic mid-run failure (same failure stage the
      // reproduced bug hit: the engine's tx callback throws).
      registry.JOBS["timesheet-drafts"].run = async () => {
        const err = new Error("regression: simulated mid-run job failure");
        throw err;
      };

      // executeJob must REJECT (callers still see the real error).
      const rejection = await executeJob(null, "timesheet-drafts", {}).then(
        () => new Error("expected executeJob to reject"),
        (e) => e, // the rejection itself is our handled value
      );
      assert.ok(
        /simulated mid-run job failure/.test(String(rejection.message)),
        `expected the original error, got: ${rejection.message}`,
      );

      // Give the cleanup chain a beat to misbehave, then require
      // that nothing escaped as an unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.deepEqual(escaped, [], `unhandled rejections escaped: ${escaped.join(" | ")}`);
    } finally {
      registry.JOBS["timesheet-drafts"].run = originalRun;
      process.off("unhandledRejection", onRejection);
    }
  });
});

// ============================================================
// SCHEDULER - provably dormant in tests
// ============================================================
describe("Sprint 24 - scheduler stays inactive in tests", () => {
  test("schedulerEnabled() is false under CDS_ENV=test", () => {
    const { schedulerEnabled } = require("../srv/jobs/scheduler");
    assert.equal(schedulerEnabled(), false);
  });
});

