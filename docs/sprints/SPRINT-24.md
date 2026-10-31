# Sprint 24 — Background Jobs & Scheduled Processing (Local-Only, Production-Compatible)

> All work in this sprint stayed inside the local repository and local SQLite setup. No deployment, remote server, remote HANA, Git commit, or Git push was performed. `npx cds compile db --to hana` was run as a **local compile check only** — it never touches a HANA server.

## 1. Sprint 23 completion gate (required first)

The gate is documented with real command evidence in [SPRINT-23-AUDIT.md](SPRINT-23-AUDIT.md):
`npm test` → 384/384 pass, exit 0; `npx cds compile srv --to csn` → exit 0; `npx cds compile db --to hana` → exit 0 (local compile only). **Gate PASSED** — Sprint 24 work started only after that.

## 2. What was built (and why this design)

A small, reusable background-job layer that COORDINATES work — it never re-implements business rules:

```
srv/jobs/
  registry.js                  <- the ONE list of supported jobs + limits
  job-run.js                   <- engine: validation, overlap guard, tx ownership, history
  scheduler.js                 <- OPTIONAL in-process timer (env-gated, OFF by default)
  run-job.js                   <- local CLI (one job, one run, no server)
  handlers/
    approval-reminders.js      <- workflow tasks due soon / overdue
    timesheet-draft-reminders.js <- Draft sheets of fully ended periods
  jobs-service.cds/.js         <- admin-only OData face (RunJob / JobRuns)

srv/compliance/handlers/
  compliance-rules.js          <- extracted SHARED reminder rules (job + action use the same)
```

Key design decisions (beginner notes):

* **Reuse over duplication.** The document-expiry reminder logic was extracted from the compliance action `NotifyDocumentExpiries` into `compliance-rules.js`. The manual action and the job now call the SAME function, so the rules can never drift apart. The behavior of the action is unchanged (its regression tests still pass).
* **No new database tables.** Reminder idempotency lives where the data already lives: a re-run can never duplicate a notification because the dedupe query checks the existing `Notification` rows (recipient + title + business record ID) before sending. Execution history is a bounded IN-MEMORY admin list (`JobRuns`), not cosmetic logging — durable job history is explicitly deferred (§9).
* **Overlap prevention.** One job cannot start while the same job is still running in the process (409 "already running"). This is a SINGLE-INSTANCE assumption, documented honestly — two app instances could run the same job concurrently; the reminder dedupe still makes repeats harmless, but true multi-instance safety needs real distributed locking (deferred to production, §9).
* **Accurate results.** The engine owns ONE transaction per run via CAP's documented `owner.tx(fn)` callback form — the whole pass commits or rolls back; failures are logged, recorded as `failed`, and reported as 500 (never success). Parameters that are invalid are rejected with clear 400s BEFORE anything runs.
* **Bounded work.** Every job caps its row selection at 500 rows per run (`MAX_ROWS_PER_JOB_RUN`) — no unbounded scans of big tables.

## 3. The implemented jobs

| Job name | Business trigger | Recipient | Dedupe ("never re-send") |
| --- | --- | --- | --- |
| `document-expiry` | Verified Active document expiring within `windowDays` or already expired; missing mandatory requirement documents (rules owned by the compliance module) | The employee themself | recipient + title + document/requirement ID |
| `workflow-approvals` | Open WorkflowTask with a `dueDate` approaching (within `windowDays`) or overdue | The resolved human approver | recipient + state-title + task ID |
| `timesheet-drafts` | Timesheet still `Draft` although its `periodToDate` has fully passed | The employee who owns the sheet | recipient + title + timesheet ID |

Deliberately NOT implemented (no invented business logic):

* No automatic escalation of workflow tasks or helpdesk tickets — reminders only, business decisions stay with people.
* Tasks for Role-based steps and tasks without an SLA (`dueDate` null) are skipped, not invented.
* No payroll processing job (out of scope; nothing half-built).
* No reminder changes any business status — a reminder is a message, never a decision.

## 4. How to run the jobs locally

In-process engine, three entry points, all the same validated code path:

**(a) CLI (simplest, no server needed):**

```
CDS_ENV=test node srv/jobs/run-job.js document-expiry --window 30      # safe in-memory smoke run
CDS_ENV=test node srv/jobs/run-job.js workflow-approvals --window 7
CDS_ENV=test node srv/jobs/run-job.js timesheet-drafts
node srv/jobs/run-job.js document-expiry --window 30                   # acts on the LOCAL DEV db.sqlite
node srv/jobs/run-job.js document-expiry --window 30 --as-of 2025-12-31 # simulation date
```

Verified real runs (CDS_ENV=test, in-memory): `document-expiry` → `ok, missingReminders: 40, employeesScanned: 10`, exit 0; `timesheet-drafts` → `ok, sheetsScanned: 0`, exit 0; `workflow-approvals` → `ok`, exit 0; unknown job name → exit 1 with a clear message.

**IMPORTANT (dev-data safety):** with no env override the CLI uses the normal local profile — your existing `db.sqlite`. The CLI never deploys a schema itself (a deploy would DROP-CREATE and wipe this data); for a FRESH file database, populate it once with the standard `npx cds deploy` command. Re-running jobs is always safe (dedupe).

**(b) Admin HTTP API (what a future Fiori admin app would call):**

```
POST /odata/v4/jobs/RunJob    {"job": "document-expiry", "windowDays": 30, "asOfDate": null}   -> summary counts
GET  /odata/v4/jobs/JobRuns                                                                        -> last 50 runs (in-memory)
```

`SystemAdmin` only (service-level `@requires:'SystemAdmin'` PLUS an in-handler re-check). Employees and HR get 403 (tested). Job history summaries contain counts and at most one sanitized error line — no row payloads, no employee data.

**(c) Scheduler (optional, OFF by default):**

```
EWMS_JOBS_ENABLED=true EWMS_JOBS_INTERVAL=60 npm run dev      # every 60 min, all jobs
```

* Only starts with `EWMS_JOBS_ENABLED=true`, and NEVER under `CDS_ENV=test` / `NODE_ENV=test` (tested: `schedulerEnabled()` returns false in tests — no timers can hang a test run).
* Interval is minutes (default 60, minimum 5). Each tick runs every registered job sequentially, skips ticks while a run is still active, logs errors and never throws into the server event loop.
* The timer is `unref()`'d and closed on cds shutdown, so startup/shutdown stays predictable.
* Adaptation for production: replace this in-process timer with a real job scheduler (BTP Job Scheduling / OS cron / one dedicated worker) — the engine API (`executeJob`) is scheduler-agnostic by design.

## 5. Execution history, retry and failure rules

* One run = one transaction: everything sent so far is committed on success, nothing on failure — no half-reminded batches.
* History per run: job name, runId, startedAt, finishedAt, status (`ok`/`failed`), safe counts, sanitized one-line error (max 200 chars, whitespace-flattened). In-memory, last 50, cleared on restart — deliberate design (no new table; production can add durable history, §9).
* Re-runs and retries: removing the last error condition and re-running does not duplicate notifications; the dedupe key makes every repeat a no-op for already-reminded business records. A documented side effect: if an eligible doc later changes state ("expires soon" → "expired"), the new state-title gets a new reminder — that is the one reminder per state, not a duplicate.
* Errors never leak SQL, paths, payloads, or stack traces — not to the HTTP caller, not into logs.

## 6. Security & privacy

* Job execution and history: SystemAdmin-only (both CDS-declared and handler-enforced; denied by HTTP tests for employee and HR users).
* The notification content contains business facts (document type, expiry date, task name, period dates) but NOT compensation data, file bytes, storage keys, or other people's IDs.
* The shared reminder core runs row-scoped queries for its single recipient (the record owner). It adds no new employee tracking and no new personal-data collection.
* No cleanup/deletion jobs: no retention policy exists in the model, so none was invented (audit history and notifications are kept).

## 7. Verification (real commands and results)

| Command | Result |
| --- | --- |
| `node --test test/jobs.test.js` (targeted) | **15/15 pass, exit 0**, no skipped/cancelled tests |
| `npm test` (full regression) | **399 tests / 119 suites, 0 fail, 0 skipped, 0 todo, exit 0** (~47 s, natural termination) |
| `npx cds compile srv --to csn` | **exit 0** |
| `npx cds compile db --to hana` | **exit 0** (local compile check only; no HANA connection) |
| CLI runs (three jobs + unknown job) | exit codes 0 / 0 / 0 / 1 as documented in §4 |

New tests in `test/jobs.test.js` cover: parameter validation (unit), authorization (403s for employee + HR, 400s for unknown jobs/bad windows/future or malformed dates), real execution with accurate counts, idempotent re-runs (0 duplicates on the second pass), history bookkeeping, and the scheduler staying dormant in tests. Existing suites (including the compliance reminder action, which now shares code with the job layer) all still pass.

## 8. Files added / modified

**Added:** `srv/jobs/registry.js`, `srv/jobs/job-run.js`, `srv/jobs/scheduler.js`, `srv/jobs/run-job.js`, `srv/jobs/handlers/approval-reminders.js`, `srv/jobs/handlers/timesheet-draft-reminders.js`, `srv/jobs/jobs-service.cds`, `srv/jobs/jobs-service.js`, `test/jobs.test.js`, `docs/sprints/SPRINT-24.md` (this file), `docs/sprints/SPRINT-23-AUDIT.md`.

**Modified:** `srv/compliance/handlers/compliance-rules.js` (new shared-rules module), `srv/compliance/handlers/summaries.js` (delegates to the shared rules; same behavior), `srv/services.cds` (register JobsService), `srv/server.js` (optional scheduler hookup).

## 9. Known limitations & production considerations (deferred deliberately)

* **Single-instance assumption.** Overlap protection and the in-memory history are per-process. Multi-instance deployments need a real coordinator (database lock, job scheduler service) — the engine interface already accepts that change without touching business rules.
* **No durable execution history.** In-memory only; if production needs an audit trail of background runs, add a persisted table (a `JobRuns`-shaped entity) or stream structured logs into observability tooling.
* **No external delivery.** Only the existing in-app notification mechanism is used. Email/SMS/Teams channels need explicit production configuration and are consciously not simulated here.
* **HANA specifics.** All queries use CAP abstractions (no raw SQL). Dedupe reads are a plain SELECT on Notification; under two concurrent workers a race could theoretically double-send one reminder — documented, and fixable with a unique key + insert-catch per instance if production requires it. `npx cds compile db --to hana` proves model compatibility but NOT runtime behavior on HANA.
* **Scheduler config lives in env vars** (`EWMS_JOBS_ENABLED`, `EWMS_JOBS_INTERVAL`) — no secrets, no URLs hardcoded; keep production values in your deployment configuration, not in code.
