# Sprint 21 — Exit Management

Backend-only module: employee separation cases with a workflow-driven
approval lifecycle, a configured (never invented) notice-period policy,
a template-seeded clearance checklist that verifies REAL underlying
evidence, integration with the Sprint 14 asset ledger and the Sprint 7
payroll process for return/settlement status, an audited correction
path, and an employment-deactivation guard that only fires at
completion. Built entirely on existing models — no new employee master
data, no second approval engine, no duplicated asset/document storage,
no new security/notification/audit framework.

Sprint 20 gate passed first (fresh evidence in SPRINT-20.md §6a:
targeted 22/22, full suite 294/294, both compiles exit 0).

---

## 1. Pre-conditions (Sprint 20 completion gate)

- Sprint 20 targeted suite: **22/22 pass, 0 fail, exit 0**
  (`test/helpdesk.test.js`).
- Full `npm test` regression at the gate (pre-Sprint 21): **294 tests /
  94 suites, 0 fail, 0 cancelled/skipped, exit 0** (~48 s, natural
  termination).
- `npx cds compile srv --to csn` and `npx cds compile db --to hana`:
  both **exit 0**, no warnings.
- SPRINT-20.md status: **COMPLETE**.

## 2. Design decisions and why

1. **One action perimeter.** Every status/date/notice move happens
   ONLY through bound actions (`Submit`, `Withdraw`, `StartReview`,
   `WaiveNotice`, `ChangeApprovedDate`, `StartClearance`,
   `MarkReadyForSeparation`, `CompleteExit`, `Correct`, `Reconsider`,
   `RecordFinalSettlement`, `CompleteItem`, `SkipItem`). `ExitCase` has
   **no UPDATE/DELETE grant for anyone** — a direct PATCH can never
   smuggle a lifecycle change and a completed case cannot be silently
   rewritten. Corrections go through the audited `Correct` action
   (HRAdmin/SystemAdmin, mandatory reason, historical `Corrected`
   event).
2. **Approvals ride the Sprint 10 generic workflow engine.** Submit
   starts `WF-EXIT-STD` (Manager → HR steps, seeded data). The engine
   resolves approvers from the LIVE active `EmployeeAssignment`, and
   its R7 rule filters the requester out of the approver list
   (self-approval impossible; a manager leaving through their own case
   auto-skips the manager step instead of deadlocking). Exit handlers
   contain NO approval logic of their own; approval outcomes arrive via
   the registered business callback (leave-engine pattern). Rejection,
   sendback, resubmit, withdraw (instance cancelled in the same
   transaction via exported engine internals) and reconsider (fresh
   instance on resubmit; the rejected one stays final) are all refusals
   or engine operations, never hand-baked state flips.
3. **Employer-initiated exits are HR-only and privacy-masked.** Only
   HR may create `EmployerInitiated` cases, and the sensitive
   `reasonText`/`reasonCategory` are masked on read for every non-HR
   reader (after-READ filter). Notification message text for these
   cases is kept neutral. `reasonText` is trimmed and validated —
   whitespace-only reasons are refused.
4. **Duplicate-safe creation, twice over.** The same
   `clientRequestId` returns a 409 pointing at the FIRST case (safe
   retries can never create a second one), and an employee with an
   exit case in any open status gets 409 for a second independent
   request. Retried clearance actions on completed items are friendly
   no-ops WITHOUT duplicate events or notifications.
5. **Notice policy is configuration, never law.** `ExitNoticePolicy`
   (per exit type, HR-maintained days) is the only rule source: a
   proposal that breaks the configured notice window is refused until
   the HR-only `WaiveNotice` records an explicit, attributed waiver,
   and a MISSING policy row surfaces as
   `noticePeriodStatus: NotConfigured` on the case instead of being
   silently treated as "no notice". No country- or contract-specific
   statute is encoded anywhere (the config gap is the documented
   decision left to HR).
6. **Clearance verifies evidence, not claims.** Checklist items are
   cloned from the ACTIVE `ExitClearanceTemplate` when HR starts
   clearance (idempotent reseeding via stable `itemCode`s;
   `itemCode`+case uniqueness also blocks a double-seed). Completion
   is CATEGORY-KEYED and re-checked server-side:
   - `Asset` items require **zero ACTIVE AssetAssignment rows for the
     employee** — the real Sprint 14 ledger, not a checkbox. The asset
     return itself must happen through the asset module's own
     `returnAsset` action; exit clearance can never falsely mark an
     asset returned.
   - `Document` items require ≥1 linked REQUIRED `ExitCaseDocument`
     row (a validated link to an existing ACTIVE Sprint 17 employee
     document — existence, ownership by the case's employee and Active
     status checked; bytes stay in the document store).
   - Other items (HR interview, manager sign-off, IT revocation) are
     role-declarations only — the handler verifies the caller holds
     the item's `responsibleRole` (or is the reporting manager) and
     says so in remarks; nothing else is claimed on their behalf.
   `MarkReadyForSeparation` AND `CompleteExit` are refused while any
   MANDATORY item is still open; mandatory and optional are
   distinguishable, and optional items can only be skipped by
   HRAdmin/SystemAdmin with a reason (`SkipItem`).
7. **Payroll status is evidence-gated.** `RecordFinalSettlement`
   (Payroll/Finance/HR roles) only flips `payrollStatus` to
   `Completed` when an existing PROCESSED/APPROVED payroll process row
   actually covers the separation month — no evidence, no claim (400).
   Without any ProcessPayroll capability gap the module never
   recomputes salaries itself; duplicate calls are no-op retries.
8. **Employment deactivation only at completion.** `CompleteExit` is
   the ONLY place `Employee.status` flips to `Inactive` (+
   `relievingDate`) — after approval/clearance gates, never merely
   because an exit was submitted. Guards: the acting user must hold
   HRAdmin/SystemAdmin-class roles, and deactivation of an HR contact
   registered in `DepartmentHR` requires SystemAdmin (generic
   automation cannot silently disable the HR ramp).
9. **Reuse instead of rebuild.** Notifications ride the shared
   `notify()` core (new `EXIT` category) at every transition:
   submission → manager + DeptHR, review → requester, approval →
   requester + manager, rejection → requester, clearance start →
   employee, completion → DeptHR. Audit rides the shared `persistAudit`
   + generic hooks; IDs come from `generateCode` (EXT0001-style);
   idempotency reuses the established `clientRequestId` pattern.
10. **Isolation mirrors Sprint 20.** Read access is
    `employee_ID = $user.employeeId` for the employee classes, all
    rows for the HR trio. Managers deliberately get NO line of sight
    (an exit is sensitive personal data — same reasoning as the
    Sprint 17/19/20 reporting surfaces). No company/legal-entity
    column is invented (documented decision).

## 3. Data model (`db/exit/exit.cds`)

| Entity | Purpose |
|---|---|
| `ExitCase` | `exitNumber` (server-generated EXT0001), employee + assignment references, `exitType`, server-stamped `initiator`, proposed/approved final working dates, `separationDate`, submitted/completed timestamps, notice snapshot (`noticePeriodDays`, `noticePeriodStatus`, waiver actor/time/reason), sensitive reason, `status`, `hrOwner`, `workflowInstanceId`, `payrollStatus`, `finalProcessingStatus`, `clientRequestId`. |
| `ExitChecklistItem` | one clearance line per case: `itemCode`/`title`/`category`/`responsibleRole`/`mandatory` from the template, status, completedBy/On, remarks. Write-free for everyone (seeded by the system, moved only by actions). |
| `ExitCaseDocument` | validated LINK (not a copy) to an existing Sprint 17 Document; `required` rows feed the Document clearance item. |
| `ExitEvent` | append-only business history (Created/Submitted/Approved/Rejected/FinalDateChanged/ItemCompleted/…/Completed/Corrected) with actor, reason, from/to status. |
| `ExitClearanceTemplate(+Item)` | HR-maintained reusable checklist, one ACTIVE at a time. |
| `ExitNoticePolicy` | HR-maintained notice DAYS per exit type; missing row = NotConfigured (visible gap, not a fake zero). |

New vocabulary: `ExitType` (Resignation, Retirement, ContractCompletion,
EmployerInitiated), `ExitStatus` (Draft, Submitted, InReview, Approved,
ClearanceInProgress, ReadyForSeparation, Completed, Withdrawn,
Rejected), `NoticePeriodStatus` (NotApplicable, Confirmed, NotConfigured,
Waived, BrokenByWaiver), `ExitReasonCategory`, `ClearanceCategory`
(Asset, Document, HR, Manager, IT, Finance), `ClearanceResponsibleRole`,
`ClearanceItemStatus` (Pending, Completed, NotApplicable),
`ExitPayrollStatus` / `ExitProcessingStatus` (Pending, Completed).
Lifecycle, chosen and documented:

```
Draft -> Submitted -> InReview -> Approved -> ClearanceInProgress
        -> ReadyForSeparation -> Completed
Submitted/InReview --(Withdraw)--> Withdrawn (workflow cancelled)
InReview --(workflow reject)--> Rejected --(Reconsider)-> Draft (resubmit = fresh instance)
Approved dates/notice may change only through authorized HR actions
Completed is final except via the audited Correct action
```

## 4. Service & security (`srv/exit/`)

`ExitService` (`@requires: authenticated-user`); grants are the
perimeter, handlers re-check ownership, exit-type sensitivity, item
roles and states server-side.

- `ExitCases` — READ: own rows for employee classes, all for the HR
  trio; CREATE: self-service for permitted types, HR-only for
  `EmployerInitiated`; NO UPDATE/DELETE for anyone. Actions carry the
  whole lifecycle (§2) with handler re-checks, Trim/validate inputs,
  404/409/412 refusals for wrong actors/states, and duplicated-retry
  no-ops.
- `ExitChecklistItems` — READ own-case rows + HR; writes only via
  `CompleteItem`/`SkipItem` (role + evidence checks).
- `ExitCaseDocuments` — CREATE/DELETE own-case rows (employee) or HR,
  with the document reference validated; NO UPDATE (immutable links).
- `ExitEvents` — HR-only (same rule as helpdesk events).
- Config entities — HR trio CRUD.
- `DepartingEmployeeAssets` — COMPUTED at read time from the Sprint 14
  assignment ledger (active assignments for the case's employee:
  tag, name, status, assigned/returned dates, condition). HR-only,
  enforced in-handler too (CAP cannot scope skip entities); requires a
  `case_ID` filter.
- Notifications: `EXIT` category via shared `notify()` (neutral text
  for EmployerInitiated); retry no-ops add none.
- Audit: generic hooks + explicit `persistAudit` rows for
  Submit/Review/Approval outcome/WaiveNotice/FinalDateChange/Item
  completion/Ready/Complete/Settlement/Reconsider/Correct.

## 5. Automated tests (`test/exit.test.js`)

11 suites / 51 tests (targeted run:
`node --test test/exit.test.js` → **51/51, exit 0**, ~8 s):

1. **creation & validation** — server-stamped initiator, generated
   `exitNumber`, required reason/trim checks, no second open case per
   employee (409), `clientRequestId` retry 409 with exactly one row,
   EmployerInitiated creation HR-only, plain employees cannot create
   cases about others;
2. **notice period & submission** — short date refused under the
   configured policy, HR waiver recorded (validated before submission
   works), adequate date accepted, missing policy → `NotConfigured`
   surfaced (case E on employee 0004), spoofed employee/date fields
   ignored;
3. **workflow approvals & decisions** — Manager → HR steps from the
   LIVE assignment, approval via the engine task (result unwrapped
   from ActionResults), self-approval impossible, requester-skip rule
   (case C), reject → 402-style refusal to proceed, sendback/resubmit
   in sequence, withdraw cancels the running instance, reconsider
   starts a fresh instance;
4. **HR review actions** — `StartReview` stamps a resolvable HR owner
   (non-resolvable refused), review-state refusals for wrong actors,
   employer-initiated masking on employee reads (HR sees plain text);
5. **clearance checklist** — seeded from the ACTIVE template only,
   idempotent reseed, responsible-role and manager-only completion
   refusals (403), category-keyed evidence: Asset item refuses while
   active assignments exist, Document item refuses with no required
   linked document, friendly no-op retries, SkipItem optional-only
   (mandatory refuses), HRAdmin-only skip;
6. **asset-return integration** — computed `DepartingEmployeeAssets`
  shows the outstanding asset from the REAL ledger, only HR read
  (employee 403), after the asset module's own `returnAsset` the
  zero-active-assignments evidence passes and the item completes,
  `MarkReadyForSeparation` still guarded by remaining mandatory items;
7. **exit documents & clearance completion** — document link validation
  (existence, ownership, Active), unvalidated reference refused,
  required doc satisfies the Document item, delete of a required link
  re-blocks completion, no UPDATE on links (403);
8. **payroll settlement integration** — `RecordFinalSettlement`
  without payroll evidence refused (400), with a real processed
  ProcessPayroll record over the separation month succeeds,
  `payrollStatus` recorded, retry is a friendly no-op with no
  duplicate audit, employee role refused;
9. **CompleteExit & corrections** — mandatory-open refusal, full
  completion flips `Employee.status` → Inactive with relievingDate,
  completed case immutability (PATCH 403), `Correct` HRAdmin-only with
  mandatory reason + `Corrected` event + audit, `CompleteExit` retry
  no-op, HR contact in DepartmentHR requires SystemAdmin (guard);
10. **privacy, notifications & audit** — JOHN sees own list only,
    others' by-ID 404, ExitEvents HR-only, EXIT notifications at
    submission/approval/rejection read strictly as recipients,
    audited lifecycle rows visible to SystemAdmin, Sprint 17/19/20
    endpoints regression smoke.

Implementation evidence trail (bugs found and fixed by these tests):
the workflow decision handler had to unwrap `ActionResults` values for
the approval path; whitespace-only reasons slipped validation until
trim checks were added; the notice-days case for employee 0004 needed
its own policy row so `NotConfigured` could be asserted; the
requester-as-approver skip (R7) surfaced dead-step skips in the engine.
All are behavior fixes, not test-weakening.

## 6. Final verification evidence

| Check | Result |
|---|---|
| `test/exit.test.js` targeted | **51 tests / 11 suites: 51 pass, 0 fail, 0 cancelled, 0 skipped, exit 0** (~8 s) |
| Full `npm test` (CDS_ENV=test) | **345 tests / 105 suites: 345 pass, 0 fail, 0 cancelled, 0 skipped, exit 0** (~47 s; processes exit naturally) |
| `npx cds compile srv --to csn` | exit 0, 0 warnings |
| `npx cds compile db --to hana` | exit 0, 0 warnings |
| Sprint 20 / earlier regression | inside the full run; no regressions (22 helpdesk + 28 policy + 24 engagement + 51 exit tests all pass within 345; the Sprint 10 regression list was extended ONLY to include the new legitimate `WF-EXIT-STD` seed, the assertion stays strict) |

No temporary probe files remain (`test/probe21*.test.js` were deleted
before the final run). No test was skipped or weakened.

## 7. Files changed / added

Added:

- `db/exit/exit.cds` — ExitCase / ExitChecklistItem / ExitCaseDocument
  / ExitEvent / ExitClearanceTemplate(+Item) / ExitNoticePolicy model,
- `srv/exit/exit-service.cds` — service, bound actions, computed
  DepartingEmployeeAssets,
- `srv/exit/exit-security.cds` — grant perimeter (incl. action grants),
- `srv/exit/exit-service.js` — service binding + audit hooks,
- `srv/exit/handlers/exit-common.js` — shared helpers (roles,
  event writer, notice-policy lookup, template seeding),
- `srv/exit/handlers/exit-lifecycle.js` — creation guards + lifecycle
  actions + workflow start/withdraw + events + audit + notifications,
- `srv/exit/handlers/exit-workflow.js` — registered business callback
  applying engine decisions to the case (+ decision notifications),
- `srv/exit/handlers/exit-clearance.js` — StartClearance seeding +
  CompleteItem/SkipItem evidence checks + Ready/Complete/Settlement/
  Correct actions with the payroll and employment-status integrations,
- `db/data/ewms.db.exit-ExitClearanceTemplate.csv` +
  `db/data/ewms.db.exit-ExitClearanceTemplateItem.csv` — the seeded
  ACTIVE clearance template,
- `db/data/ewms.db.workflow-WorkflowDefinition.csv` +
  `db/data/ewms.db.workflow-WorkflowStep.csv` — extended with the
  `WF-EXIT-STD` (Manager → HR) definition and its two steps,
- `test/exit.test.js` — 51-test targeted suite,
- `docs/sprints/SPRINT-21.md` — this report.

Changed:

- `db/schema.cds` — include the exit namespace,
- `db/common/enums.cds` — Sprint 21 enums + `EXIT` notification
  category,
- `srv/services.cds` — serve ExitService + security,
- `db/data/ewms.db.payroll-EmployeeSalary.csv` +
  `db/data/ewms.db.payroll-SalaryStructureItem.csv` +
  `db/data/ewms.db.employee-EmployeeHistory.csv` — seed data needed for
  the payroll-process evidence path used by the settlement tests,
- `db/data/ewms.db.recruitment-OnboardingChecklist.csv` +
  `…-OnboardingChecklistItem.csv` +
  `db/data/ewms.db.compliance-DocumentRequirement.csv` +
  `db/data/ewms.db.geo-Geofence.csv` — editorial seed alignment while
  extending the shared CSV pattern (no behavior change),
- `test/regression-s1-11.test.js` — expected WF-definition list
  extended with the new `WF-EXIT-STD` seed (assertion stays strict),
- `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md` — Sprint 21 section + TOC +
  roadmap note moved to "no planned modules",
- `SETUP.md` — Sprint 21 test file listed.

## 8. Remaining policy decisions / limitations (documented, not blocking)

1. **Notice-period policy must be maintained by HR** — days per exit
   type are configuration; until HR maintains a row for an exit type,
   that type records `NotConfigured` and keeps working without a fake
   zero. No statutory/contract-specific rule is invented in code.
2. **Notice in calendar days** — no working-day calendars applied to
   notice computations.
3. **Historical evidence limits** — assets: return evidence comes from
   the live ACTIVE-assignment check (the ledger keeps closed
   assignment rows, so the event history is preserved, but the
   clearance item keys off the CURRENT state); documents: links must
   be Active Sprint 17 rows.
4. **FSS/exit-payroll scope** — the module records the payroll OUTCOME
   with evidence (a processed payroll run covering the separation
   month); it does NOT compute final-settlement components
   (gratuity/benefits/tax) — that would need a payroll-side
   requirement and its own sprint.
5. **Access-revocation is in-process only** — `CompleteExit`
   deactivates the Employee MASTER record (status + relievingDate)
   with the audit trail retained; external identity-provider or
   account-deactivation integration does not exist in the repo and is
   NOT claimed anywhere. HR contacts need SystemAdmin sign-off
   (guard); SystemAdmin deactivation itself is the documented manual
   process responsibility.
6. **Managers have no exit-case line of sight** (documented privacy
   decision; the approver path uses the workflow engine's task
   surface, which is separately granted).
7. SQLite/HANA: plain tabular data + managed aspects; HANA runtime
   profile remains untested (standing limitation across all sprints).

## 9. Final status: **COMPLETE**

No unresolved critical authorization or data-integrity defects: all
lifecycle moves are action-gated and state-validated, direct writes
have no grants (anti-bypass and immutability asserted by tests),
self-approval is impossible (engine R7 + grant layer), clearance cannot
be bypassed without REAL evidence, payroll settlement cannot be claimed
without payroll evidence, employment status flips only at completion
under role guards, and every transition is audited. Production
readiness is NOT claimed from local tests (HANA/BTP auth/deployment,
external account-revocation integration unexercised; standing
limitations documented above).

Stop here — Sprint 22 has NOT been started.
