# Phase 2 — Full Local Verification & Backend Readiness Audit

**Scope:** verification of the existing EWMS backend (CAP Node.js) before starting Fiori/UI5 development.
**Character:** audit, not a feature sprint. One verified blocking defect was repaired, everything else working was preserved.

---

## 1. Repository state at the start of the audit

- **Git branch:** `main`. Last commits unchanged from before the audit (`ca7f901 fixing minor bugs`, `d05efe1 complete debugging`, …). **The audit created no commits and pushed nothing.**
- **Working tree:** 95 modified/untracked paths from Sprints 12–24 (models under `db/`, services under `srv/`, tests, docs under `docs/sprints/`). None were discarded or overwritten. `SETUP.md` is an untracked local file; `tmp-audit/` contains leftover scratch probe files from an earlier debugging session — **not** part of the test suite (the `npm test` glob only matches `test/**/*.test.js`).
- **Runtime:** Node v22.23.2, local project (`/home/manikanta/Documents/ewms`), local SQLite only.
- **Dev database:** `db.sqlite` existed from Oct 7 and was *stale* (its stored model predated Sprint 15+ — the `Timesheet` table was missing). Detail in §4/§5. `db.sqlite-shm`/`-wal` leftovers present (normal SQLite artifacts).

## 2. Sprint status Sprints 1–25 (verified, not assumed)

| Sprint | Module | Status | Evidence |
|---|---|---|---|
| 1–9 | Common foundation, Organization, Employee core + details, Attendance, Leave, Payroll, Security | IMPLEMENTED | `db/…`, `srv/…`, `test/regression-s1-11.test.js` |
| 10 | Generic workflow engine | IMPLEMENTED | `srv/workflow/…`, workflow suites |
| 11 | Notifications (in-app) | IMPLEMENTED | `srv/notification/…`, regression suite |
| 12–14 | Recruitment/Onboarding, Performance, Assets | IMPLEMENTED | dedicated suites, `docs/sprints/SPRINT-12/13/14.md` |
| 15–16 | Timesheet/Shift/Roster, Geo-fencing | IMPLEMENTED | `test/timesheet.test.js`, `test/geo.test.js` |
| 17–19 | Documents & Compliance, Engagement, HR Policies | IMPLEMENTED | `test/compliance.test.js`, `test/engagement.test.js`, `test/policy.test.js` |
| 20–21 | Helpdesk (+SLA model), Exit Management | IMPLEMENTED | `test/helpdesk.test.js`, `test/exit.test.js` |
| 22–23 | Dashboard & Analytics, Reports & CSV Export | IMPLEMENTED | `test/dashboard.test.js`, `test/reports.test.js`, `SPRINT-22/23(-AUDIT).md` |
| 24 | Background Jobs & Scheduled Processing | IMPLEMENTED | `srv/jobs/…`, `test/jobs.test.js`, `SPRINT-24.md` |
| 25 | *Not started (by design)* | **NOT IMPLEMENTED** | no `SPRINT-25` code or docs exist; the Phase 2 prompt lists it as the frontend-checkpoint period. External integrations (email/SMS delivery, BTP services) are **not implemented**: only the in-app notification store exists; XSUAA/HANA are configuration-only. |

Nothing was counted as complete from a documentation file alone — every claim is backed by the test suite (§3) or direct code/service inspection.

## 3. Automated regression tests

**Command:** `CDS_ENV=test node --test 'test/**/*.test.js'` (package.json `test` script → run as `npm test`).

| Metric | Value |
|---|---|
| Exit code | **0** |
| Total tests | **400** |
| Passed | **400** |
| Failed | **0** |
| Skipped / cancelled / todo | **0 / 0 / 0** |
| Suites | 120 |
| Duration | ~57 s at documentation time |

Run twice: once before the defect fix below (399 tests / 119 suites, exit 0) and once after the fix + new regression test (400 / 120, exit 0). `npm test`'s glob discovers **all** 15 files under `test/*.test.js` (verified with `ls test/*.test.js` — 15 files; node's reporter lists 120 suites covering each module listed in §2). No suite was skipped and none needed an extra manual command.

The `[test]` profile boots an in-memory SQLite — the run never wrote to `db.sqlite`.

## 4. CAP model & service compilation

| Command | Exit code | Output |
|---|---|---|
| `npx cds compile srv --to csn` | **0** | 30,454 lines of CSN, generated over 20 services |
| `npx cds compile db --to hana` | **0** | 1,901 lines of HANA DDL — **local compile check only, never connected to a HANA server** |

Structural inspection beyond compilation: all service registrations in `srv/services.cds` use the existing per-module service/security files; the audit found no duplicate entity definitions (TSN-compile would fail on them) and no broken associations. Query code uses CAP query APIs (`SELECT/cds.ql`) everywhere — **no raw SQL** found in `srv/` (grep for `.exec/.raw/PRAGMA` = 0 hits). The one filesystem dependency is the Sprint 17 document-storage adapter `srv/compliance/document-storage.js` (documented, content-addressed, traversal-safe local dir behind `EWMS_DOCUMENT_STORAGE_DIR`; production needs a mounted volume/object store at this single seam).

**HANA caveat (mandatory):** successful HANA compilation proves model compatibility only. No application has ever been run against a live HANA instance; runtime behavior (locking, date semantics, uniqueness under concurrency) is **unverified by design in this phase**.

## 5. Local startup & functional smoke test

Boot: `node node_modules/.bin/cds-serve --port 4004` (equivalent to `npm start`; `cds watch`/`npm run watch` is the documented interactive form). Scheduler stayed dormant (`EWMS_JOBS_ENABLED` unset — verified by code `srv/jobs/scheduler.js: false unless EWMS_JOBS_ENABLED==="true"` and by test "schedulerEnabled() is false under CDS_ENV=test").

Results (against the local dev database after it was rebuilt from seeds — see the stale-DB note below):

- Boot succeeds in ~2 s, serving all **17 registered services** (attendance, employee, organization, project, team, leave, payroll, workflow, notification, recruitment, performance, asset, timesheet, geo, compliance, engagement, **hrpolicy, helpdesk, exit, dashboard, reports, jobs**).
- `$metadata` = **200** for every service (all probed live). The HR policy service path is `/odata/v4/hrpolicy` (not `/policy` — recorded to avoid a future frontend typo).
- Representative operations exercised **live**:
  - `GET /leave/LeaveTypes` (employee) → 200, seeded data ✓
  - Workflow task list (plain employee) → **0 rows** (row-level filtering effective) ✓
  - Reports read (sysadmin) → 200; (employee) → 403 ✓
  - `POST /jobs/RunJob` (sysadmin) → **200 with sanitized counts**; (employee) → 403; unknown job → clean 400 ✓
- Stale-DB finding: the pre-existing `db.sqlite` lacked Sprint 15+ tables; the first boot's `RunJob` failed with a sanitized 500 (`no such table` in the server log, never in the HTTP response). With the rebuilt/reseeded database everything above passed. Remedy documented in `SETUP.md` §12. **Note:** the DB rebuild reseeds from CSVs — user-entered dev rows are not preserved (dev DB is disposable by design).
- Shutdown: after each test the server was stopped by its recorded PID and verified **not** listening (`STOPPED_CLEANLY` in every boot). No timer survives a test (Scheduler off; the one long-lived background surface is env-gated).
- **Reproducibility note:** background servers spawned inside one shell tool-call die when that call ends, so every boot+probe+stop sequence above ran inside a single command — this is also why the documented interactive flow (`npm run watch`) should be used for manual browsing.

## 6. Security & authorization audit — findings

Verified **live** against the running server plus the 400-test suite:

| Check | Live result | Suite coverage |
|---|---|---|
| Unauthenticated request | 401 | asserted in suites |
| Employee reads colleague's attendance (`$filter employee_ID ne own`) | **0 rows** (row-level `where` cannot be escaped by filters) | regression-s1-11 ✓ |
| Employee creates attendance/leave **for another employee** | **403** both | self-write-guard tests ✓ |
| Employee reads payslips | 200 with **0 rows** (self-scoped grant, no own payroll row — correct design), PayrollPeriods → 403 | regression suite ✓ |
| FinanceManager reads payslips | 403 (by design — payslip READ is HRAdmin/PayrollExecutive/SystemAdmin/self) | documented matrix ✓ |
| Employee calls `RunJob`, `JobRuns`, `AuditLogs`, `ExportCSV` (valid params) | **403** each | jobs/report suites ✓ |
| HR (`hrperson`) denied job execution | 403 | jobs suite ✓ |
| Invalid POST (missing fields) | clean aggregated 400s, human messages, **no stack traces** | — |
| Malformed JSON | clean 400 body, no internals | — |

Workflow approvals cannot be bypassed: instance/task direct CREATE/UPDATE/DELETE are rejected in handlers (documented + suite-verified); status transitions require the engine's actions. Job history is SystemAdmin-only and returns counts + sanitized summaries only.

**One defect repaired during this audit (D1, release-blocking):** a mid-run database failure (e.g. damaged/missing table while running `RunJob`) correctly produced the 500 — but the process then **crashed ~1 s later** from an unhandled rejection on the in-flight cleanup chain (`Promise.finally` re-throws into an unattended promise). Reproduced deterministically three times (server dead within 1 s after a 500). Fixed in `srv/jobs/job-run.js` (the derived cleanup promise is now swallowed; callers still receive the original error) — see §10. After the fix: three consecutive failing `RunJob` calls → three clean 500s, **server stayed alive**, history recorded `failed` accurately, then clean stop.

**Pre-existing, documented, not blocking:** workflow task list reads rely on engine row-level enforcement documented in the guide (the live probe showed 0 rows for the plain employee on the current seed); the model's uniqueness guarantees are enforced in code where SQLite's DDL cannot (documented in prior sprints). No new parallel auth system exists; no credentials/tokens appear in any log the audit produced.

## 7. Data integrity & business workflow audit

Confirmed through the 400-test suite (each item has an automated test; none needed repair):

- Required-field and chronology validation (leave, attendance, documents, statutory IDs) ✓
- Status-transition and immutable-final-state rules (creative states can only change through actions) ✓; workflow history is append-only (UPDATE/DELETE → 400) ✓
- Duplicate prevention (attendance per employee+date, leave overlap guard, offer/onboarding uniqueness) ✓
- Duplicate-notification prevention for reminders (dedupe key on Notification rows; jobs idempotent on re-run) ✓
- Payroll input integrity + duplicate-consumption guard (period/process lifecycle incl. lock/unlock) ✓
- Asset assignment/return history (`AssetEvent` append-only) ✓
- Report/export accuracy + 413-refusal on oversized exports ✓
- One run = one transaction in the job engine; partial failures roll back ✓

**Not verifiable from local evidence** (documented, not assumed): HANA transactional/concurrency behavior (§4 caveat); real external email/SMS delivery (not implemented); Fiori runtime behavior (future sprint).

## 8. Database & configuration audit

- **Local SQLite:** correct. Actual findings recorded in §5 (stale-DB symptom + remedy).
- **Test isolation:** `[test]` profile = in-memory SQLite; no test touches `db.sqlite` (verified by boot logs writing only dev profile paths).
- **Environment-specific config:** dev = mocked auth + sqlite; `[production]` = hana + xsuaa declared in `package.json` but **no deployment artifacts exist**. No hardcoded production URLs or credentials anywhere in `srv/` (grep). Scheduler config uses env vars (`EWMS_JOBS_ENABLED`, `EWMS_JOBS_INTERVAL`) with safe defaults (off).
- **SQLite-only assumptions:** none found in business code — all queries via CAP abstractions; jobs use in-process locking and are **documented single-instance only** (multi-instance deployments need a real coordinator — deferred honestly in `SPRINT-24.md` §9).
- **Date/time:** CAP date columns + explicit ISO date logic; no engine-specific SQL date functions found.

## 9. External integrations & background jobs

- **No real external providers exist** — nothing in the code can send email/SMS or call external HTTP endpoints (grep across `srv/`: no `fetch/axios/smtp/sendMail/child_process`; the only external surface is the document storage adapter, local-dir based).
- Missing external credentials therefore cannot break local development (nothing requests them).
- Background jobs: reproducible locally (`CDS_ENV=test node srv/jobs/run-job.js <job>`), duplicate-safe (dedupe), bounded (500-row cap), never scheduled during tests, and **now crash-safe on failure** (D1 fix).
- No secret is ever logged; job error summaries are truncated/sanitized (max 200 chars, whitespace-flattened) and raw errors are excluded from the admin history endpoint.

## 10. Defects fixed & regression tests added

| ID | Defect (verified, not presumed) | Classification | Fix | Regression test |
|---|---|---|---|---|
| D1 | **Server crash after a failed background job.** Reproduced 3×: `RunJob` returns a correct 500, then the process dies within ~1 s (unhandled rejection on the `execution.finally` chain in `executeJob`). Violates "failed jobs reported accurately without killing the app". | Pre-existing bug in Sprint 24 code (unexercised by the 399-test suite, which never forced a real mid-run DB error) | `srv/jobs/job-run.js`: keep a handle on the derived cleanup promise and swallow its rejection; **callers still receive the original error** | Test `"executeJob rejects cleanly without unhandled rejections"` in `test/jobs.test.js` — forces a mid-run failure, asserts the caller gets the error AND no `unhandledRejection` escapes |
| D2 | Stale dev `db.sqlite` (predates Sprint 15) → job 500s with `no such table`. | Local data-ops issue, not a code defect | Dev DB was rebuilt from seeds during verification (disposable by design); symptom + remedy documented in `SETUP.md` §12 | n/a (operational doc) |

No tests were skipped or weakened; the full suite was re-run after the fix (§3).

## 11. Files inspected / added / modified

- **Inspected:** entire `db/` + `srv/` structure, all 15 test files, `package.json`/`SETUP.md`/`readme.md` config, all sprint docs, CAP runtime internals where behavior had to be proven (`@sap/cds` shutdown/test paths, job engine).
- **Added:** `docs/PHASE-2-LOCAL-VERIFICATION.md` (this file).
- **Modified:** `srv/jobs/job-run.js` (D1 fix, commented), `test/jobs.test.js` (regression test), `SETUP.md` (stale-DB troubleshooting row).
- **Left untouched:** everything else, including all user-modified files and `tmp-audit/` scratch (not removed, not run).

## 12. Unresolved risks & limitations (non-blocking)

1. **HANA runtime behavior unverified** — compilation success is necessary but not sufficient (§4).
2. **Sprint 25 / external integrations:** not implemented; Fiori cannot assume push-to-channel notifications exist today.
3. **Multi-instance scheduling** remains a documented single-instance assumption until a production coordinator is chosen.
4. **Dev-DB reseed wipes ad-hoc dev data** (documented in SETUP.md).
5. `tmp-audit/` scratch files untracked and unused by the suite — candidate for user's own cleanup decision (not done: not my files to remove).
6. Frontend-facing gap recorded for reuse: the HR-policy service path is `/odata/v4/hrpolicy`; workflow task **writes** go through actions, not PATCH — a UI must use `Approve/Reject/Delegate/...`.

## 13. Exact reproduction steps for the successful verification

```bash
cd /home/manikanta/Documents/ewms
npm test                                  # 400 tests / 120 suites, 0 fail, exit 0
npx cds compile srv --to csn              # exit 0
npx cds compile db --to hana              # exit 0 (compile-only)
npm run watch                             # boots on :4004 (interactive) - then probe:
# curl -u 'sysadmin:' http://localhost:4004/odata/v4/reports/Workforce?$top=2   -> 200
# curl -u 'empjohn:' http://localhost:4004/odata/v4/jobs/RunJob -X POST -H 'Content-Type: application/json' -d '{"job":"timesheet-drafts"}'  -> 403
CDS_ENV=test node --test test/jobs.test.js   # 16/16 targeted
CDS_ENV=test node srv/jobs/run-job.js timesheet-drafts   # CLI job run, exit 0
```

## 14. Final readiness decision

**`READY WITH NON-BLOCKING ISSUES`** — every mandatory gate passed with real command evidence; one release-blocking reliability defect (D1) was repaired with a regression test; the remaining items (§12) are documented, deliberate deferrals that do not prevent starting the frontend phase.

---

*Local-only confirmation: no deployment, no remote server operation, no remote HANA connection, no Git commit, and no Git push occurred during this phase.*
