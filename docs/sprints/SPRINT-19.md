# Sprint 19 — HR Policy Management

Backend-only module: configurable HR policies with a per-version
lifecycle, configurable applicability, employee acknowledgment evidence,
and HR-only outstanding reporting + dedupe-safe reminders. Built on the
existing Employee/Organization models — no new master data, no duplicate
document storage, no new security/audit/notification framework.

Sprint 18 gate (see SPRINT-18.md) passed first: full suite 272/272
(including the new 28 Sprint 19 tests), `cds compile` clean.

---

## 1. Pre-conditions (Sprint 18 completion gate)

- Sprint 18 targeted suite: **24 tests pass, 0 fail** (`test/engagement.test.js`).
- Full `npm test` regression at the gate (pre-Sprint 19): **244/244 pass, 0 fail, exit 0**.
- `npx cds compile srv --to csn` and `npx cds compile db --to hana`: both exit 0.
- Final SPRINT-18.md status: **COMPLETE** (documented evidence there).

## 2. Design decisions and why

1. **Identity vs. lifecycle split.** `Policy` is the stable identity
   (unique `policyCode`, title, category, owner, applicability scope);
   `PolicyVersion` carries its OWN lifecycle state. Publishing v2 can
   therefore never silently overwrite v1, and the acknowledgments that
   point to v1 stay provable ("acknowledged v1" survives v2). A new
   version supersedes an old one by **status change only** — old
   acknowledgment rows are never touched, deleted, or copied.
2. **One OData perimeter = one workflow perimeter.** Direct
   `POST/PATCH/DELETE` on `PolicyVersions` has no grant; versions are
   created ONLY via the bound `CreateVersion` action (deep/nested creates
   are refused at the header handler too) and moved ONLY via bound
   lifecycle actions. `PATCH` cannot flip a status or rewrite published
   content — the states are not writable fields at all.
3. **Header freeze.** Once any version leaves Draft, the policy header
   (title/category/applicability/owner) becomes immutable: silently
   re-scoping a published policy is re-scoping its audience. Changing it
   requires a new version.
4. **Approval = single HR review gate, not the workflow engine**
   (documented decision, same shape as the Sprint 18 suggestion review).
   The generic `WorkflowDefinition` engine is reserved for journey
   approvals (leave/timesheet); policy needs a two-role separation of
   duties (submitter ≠ approver), enforced in the handler, with a full
   audit trail — a workflow pipeline would add bookkeeping without
   adding a required approval step. This is NOT a separate framework.
5. **Sprint 17 document store deliberately NOT reused.** It is
   employee-scoped by design (`Document.employee` is NOT NULL);
   repurposing it for policy content would refactor a completed sprint.
   Policy content is `LargeString` full text **or** `contentReference`
   (a locator for an externally hosted document). At least one is
   required per version.
6. **Applicability is configurable, never hardcoded law.** Company,
   country, department and employment type axes are all nullable — null
   means "no restriction on that axis". Resolution re-uses the existing
   `Employee → latest EmployeeHistory → Department → BusinessUnit →
   Company` chain and the department `Location.country`.
7. **No scheduled jobs invented.** The repository has no background
   scheduler, so `SendPolicyReminders` is a manual, dedupe-safe trigger
   designed for an external cron/job task. Nothing is claimed to be
   "scheduled".

## 3. Data model (`db/hr-policy/hr-policy.cds`)

| Entity | Purpose |
|---|---|
| `Policy` | Identity: `policyCode` (unique, HR-enforced), title, description, `PolicyCategory`, owner (association to Employee), owningDepartment, applicability axis (company/country/department/employmentType), `requiresAcknowledgment`, fixed `acknowledgmentStatement`. |
| `PolicyVersion` | One revision per row: server-assigned `versionNo` (highest + 1; clients can never pick a number), `content` / `contentReference`, status, submit/decide/publish/withdraw trails, `effectiveDate` (validated not in the past), `expiryDate`, `reviewDate`, `clientRequestId` idempotency token. |
| `PolicyAcknowledgment` | One employee × one version, immutable: server-set `acknowledgedOn`, the accepted statement COPIED for evidence, optional free-text `evidenceNote`. |

Version vocabulary (new enum `PolicyVersionStatus`):
`Draft → InReview → Approved → Published → (Superseded)`, Reject → back to
`Draft`, `Published → Withdrawn → Archived`. New enum `PolicyCategory`:
CodeOfConduct, AttendanceAndLeave, Compensation, WorkplaceSafety,
InformationSecurity, Other.

## 4. Service & security (`srv/hr-policy/`)

`HRPolicyService` (`@requires: authenticated-user`), grants are the
perimeter; handlers re-check row ownership, lifecycle state and
applicability server-side (hiding a UI field is not security).

**Entities & actions**

- `Policies` — READ for all authenticated role groups (header carries no
  confidential content); CREATE/UPDATE/DELETE for the HR trio
  (HRExecutive/HRAdmin/SystemAdmin). Bound `CreateVersion(content,
  contentReference, effectiveDate, expiryDate, reviewDate,
  clientRequestId)` — HR trio only; refuses while a Draft/InReview
  version is pending; copies forward from the latest version; identical
  `clientRequestId` retries return the existing draft (no duplicates).
- `PolicyVersions` — HR trio sees all versions; everyone else is
  grant-gated to `status = 'Published'` (and then applicability-filtered
  in the handler), so Drafts/reviews/unpublished versions are invisible
  by grant, not just by UI. Bound actions:
  `SubmitForReview` (HR trio + owner; Draft→InReview, validates dates),
  `Approve`/`Reject` (HRAdmin/SystemAdmin only; approver ≠ submitter;
  Reject requires comments), `Publish` (automatically supersedes the
  previously published version by status only), `Withdraw` (reason
  required; employees immediately lose visibility), `Archive`,
  `Acknowledge` (self-only).
- `PolicyAcknowledgments` — no CREATE/UPDATE/DELETE grant for anyone;
  records exist only via `Acknowledge` and are immutable (handler
  re-rejects direct writes). READ: own rows only for
  Employee/Manager classes (`where: 'employee_ID = $user.employeeId'`),
  full read for the HR trio.
- `OutstandingAcknowledgments` — **computed at read time** (`persistence.skip`
  + custom READ handler): the current published+effective version of every
  acknowledgment-required policy × every employee inside its scope −
  existing acks. Never stale. HR-only (same line-of-sight rule as Sprint 17:
  managers get no cross-employee acknowledgment data). Honors simple
  `policy_ID` / `employee_ID` filters.
- `SendPolicyReminders(daysBefore)` — HR trio only; (1) outstanding
  acknowledgment reminders per employee × version and (2) upcoming
  `reviewDate` reminders to the policy owner. Dedupe-safe: the same
  recipient + version (recipient + review topic) combination is never
  reminded twice; safe for repeated cron calls.

**Notifications & audit** ride the shared `notify()` core and
`persistAudit` helper used by every module (category `POLICY`); no
duplicated frameworks. Lifecycle transitions (CreateVersion, submit,
approve, reject, publish, withdraw, archive) and reminder sends write
audit rows.

## 5. Automated tests (`test/policy.test.js`)

9 suites / 28 tests (targeted run: `CDS_ENV=test node --test test/policy.test.js`):

1. policy creation & validation — code/title/category required, duplicate
   code 409, nested version creation refused;
2. anti-bypass guards & header freeze — direct POST/PATCH/DELETE on
   versions and deep payload bypasses refused (405/403), header
   immutable once published, PATCH cannot move lifecycle;
3. version creation & idempotency — server-assigned numbering,
   copy-forward, `clientRequestId` retry returns the same draft;
4. lifecycle transitions — submit/approve/reject/publish/withdraw/archive
   including wrong-state and wrong-actor refusals (employee cannot
   approve; submitter cannot self-approve);
5. acknowledgment, supersession & immutability — ack only published +
   effective + applicable + self; duplicate ack never creates a second
   row; old acknowledgments survive v2 publication; direct writes on
   records refused; cross-employee denial (`$user.employeeId` scoping);
6. applicability & company isolation — company/country/employment-type
   axes; an employee outside the scope cannot read or acknowledge;
7. outstanding reporting & reminders — computed view is HR-only with
   simple filters, `requiresAcknowledgment=false` excluded, dedupe-safe
   reminder run + `reviewDate` owner reminder, POLICY notification
   category, notifications privacy;
8. audit trail — transitions visible in `AuditLogs` (SystemAdmin);
9. regression smoke — Sprint 17 documents and Sprint 18 engagement
   endpoints still work.

## 6. Final verification evidence

| Check | Result |
|---|---|
| `test/policy.test.js` targeted | **28/28 pass, 0 fail, exit 0** |
| Full `npm test` (CDS_ENV=test) | **272 tests / 83 suites: 272 pass, 0 fail, 0 cancelled, 0 skipped, exit 0** (~35–52 s; processes exit naturally) |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` | exit 0 (`LargeString` → NCLOB; no String-size errors) |
| Sprint 17 / 18 regression | covered inside the full run; no regressions |

A leftover debug probe file (`test/probe19.test.js`) from development was
matched by the `npm test` glob and **hung** the first full run after all
real suites had passed; it was deleted — with it removed the full suite
terminates naturally (evidence above). No test was skipped or weakened.

## 6a. Requirement classification (Sprint 20 pre-gate re-run, fresh evidence)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Policy data model & version history | PASS | `db/hr-policy/hr-policy.cds`; suite 3 (numbering, copy-forward, idempotent retries) |
| 2 | Draft/review/approval/publication/withdrawal lifecycle | PASS | suites 2, 4 (`CreateVersion`/`SubmitForReview`/`Approve`/`Reject`/`Publish`/`Withdraw`/`Archive` bound actions only) |
| 3 | Unauthorized direct PATCH refused | PASS | suite 2 (PATCH cannot move status or touch published content; version entity has no write grants) |
| 4 | Applicability & effective-date validation | PASS | suites 5, 6 (`effectiveDate` not in the past; axes resolved via Existing EmployeeHistory chain) |
| 5 | Employee access to applicable published versions | PASS | suites 5, 6 (grant-gated to `status = 'Published'` + handler applicability filter) |
| 6 | Acknowledgment of the correct policy version | PASS | suite 5 (row points at the exact `PolicyVersion`; statement copied for evidence) |
| 7 | Duplicate acknowledgments / unsafe retries | PASS | suite 5 (same employee × version returns the existing record) |
| 8 | Outstanding / overdue acknowledgment queries | PASS | suite 7 (computed HR-only view; `reviewDate` reminders) |
| 9 | Workflow / notification / audit integration | PASS (workflow N/A by documented decision) | suite 7 (POLICY notifications via shared `notify()`), suite 8 (audit rows via shared `persistAudit`) |
| 10 | Self-access, admin authorization, company isolation | PASS | suites 5–7 (`$user.employeeId` scoping; out-of-scope denial; HR-only reporting) |
| 11 | Automated tests & documentation | PASS | 28-test suite + this report + guide §5.19 |

Fresh gate run (Sprint 20 start): targeted **28/28 pass, 0 fail, exit 0**; full
`npm test` **272/272 pass, 0 fail, 0 cancelled/skipped, exit 0** (~37 s,
natural termination); `cds compile srv --to csn` and `cds compile db
--to hana` both **exit 0**. **Sprint 19 gate: passed.**

Post-Sprint 20 confirmation (no policy regression): the full suite after
Sprint 20 runs **294/294 pass, 0 fail, exit 0** (see
`docs/sprints/SPRINT-20.md` §6).

## 7. Files changed / added

Added:

- `db/hr-policy/hr-policy.cds` — Policy / PolicyVersion /
  PolicyAcknowledgment model,
- `srv/hr-policy/hr-policy-service.cds` — service + actions,
- `srv/hr-policy/policy-security.cds` — grant perimeter,
- `srv/hr-policy/hr-policy-service.js` — service binding (filename-bound
  by CAP), composing the handlers below,
- `srv/hr-policy/handlers/policy-common.js` — shared helpers (employee
  scope resolution, applicability check, role checks),
- `srv/hr-policy/handlers/policy-lifecycle.js` — header guards, version
  lifecycle, audit,
- `srv/hr-policy/handlers/acknowledgments.js` — Acknowledge, computed
  outstanding view, reminders,
- `test/policy.test.js` — 28-test targeted suite,
- `docs/sprints/SPRINT-19.md` — this report.

Changed:

- `db/schema.cds` — include the hr-policy namespace,
- `db/common/enums.cds` — `PolicyCategory`, `PolicyVersionStatus`,
- `srv/services.cds` — serve HRPolicyService + security,
- `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md` — Sprint 19 section + TOC +
  roadmap table updated,
- `SETUP.md` — Sprint 19 test file listed,
- `docs/sprints/SPRINT-18.md` — post-Sprint-19 regression note.

## 8. Remaining policy decisions / limitations (documented, not blocking)

1. **Approval depth** — one HR review gate with separation of duties.
   Multi-step committee approvals would be a policy/workflow-engine
   integration decision, not a defect; the Resolve/Approve shape matches
   Sprint 18's review pattern.
2. **No background scheduler** — reminders require an external cron/job
   calling `SendPolicyReminders` (retry-safe). No emailed delivery: the
   notification `EMAIL` channel is enum-only across all sprints.
3. **Retirement/expiry of old versions** — `expiryDate`/`Superseded`
   versions remain readable to the HR trio and (where once `Published`)
   to employees whose acks point at them; no auto-archival job exists.
4. ** country/department matching** is exact case-insensitive equality;
   jurisdiction hierarchies (country → region) would need a config table
   if ever required (no legal requirement hardcoded anywhere).
5. SQLite/HANA: plain tabular data + managed aspects (`LargeString` →
   NCLOB compiles clean); HANA runtime profile remains untested
   (standing limitation across all sprints).

## 9. Final status: **COMPLETE**

No unresolved critical authorization or data-integrity defects: direct
OData bypasses are grant- and handler-refused, acknowledged versions
cannot be silently overwritten, acknowledgment evidence is immutable and
self-scoped, company/applicability isolation is server-enforced, and
reporting is HR-only. Production readiness is NOT claimed from local
tests (HANA/b.auth/patch deployments unexercised, standing limitations).
