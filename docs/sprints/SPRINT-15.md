# Sprint 15 — Timesheet, Shift & Roster Integration

**Status:** ✅ Completed

Sprint 15 adds full **Timesheet** functionality to EWMS and repairs
the broken integration points of the attendance modules it leans on.
Employees record worked time per reporting period, submit it to their
reporting manager, the manager starts a review and approves or rejects
it, and the **approved** sheets become (this is the key new bridge)
payroll input — consumed **exactly once** and frozen afterwards.
Approval can additionally run through the existing Sprint 10 generic
workflow engine. Backend only: OData V4, CDS, SQLite/HANA-ready, no
UI, no deployment.

---

## 1. What this sprint changed (and why)

### 1.1 Defect repairs found at baseline (before the timesheet work)

`npm test` started at **166 tests / 5 failures**. All five were
regressions in the very modules Sprint 15 must integrate with, caused
by CAP handler **entity-name mismatch**:

| Defect | Root cause | Fix |
|---|---|---|
| ShiftAssignment validation dead (bad date order, overlaps, cross-employee PATCH accepted) | handlers registered on db name `"ShiftAssignment"` but the served entity is `ShiftAssignments` — the handler never fired | [srv/attendance/handlers/shift-assignment.js](../../srv/attendance/handlers/shift-assignment.js) rewritten: served-name registrations, working overlap query (tagged-template where), **open-ended supersession** rules |
| Overtime validation dead (bogus approver accepted) | same name mismatch (`"Overtime"` vs `Overtimes`); approvedBy validated only on UPDATE | [srv/attendance/handlers/overtime.js](../../srv/attendance/handlers/overtime.js): served-name bindings + approver existence check on CREATE |
| WorkSchedule/Shift/Holiday/HolidayCalendar guards dead | same name mismatch | same one-line-class fix in all four handler files (plus two logic typos: holiday duplicate check used `req.ID`, calendar duplicate check merged `req.data.name` into the year) |
| Overtime `workedHours`/`attendance` references crashed | `srv.entities` in the attendance service does not contain Employee/Attendance master data | foreign entities addressed via qualified db names (project convention) |
| Payroll re-run duplicated rows | previously **Rejected** process rows were neither skipped nor cleared, so re-processing created a second row per employee | [srv/payroll/handlers/payroll-engine.js](../../srv/payroll/handlers/payroll-engine.js): re-run clears Pending/Processed/**Rejected**; only Approved/Published stay frozen |
| Audit hook list ("Attendance"/"Overtime") | never matched served short names → writes silently not audited | fixed in [srv/attendance/attendance-service.js](../../srv/attendance/attendance-service.js) |

Regression proof: the pre-existing failing suite
[test/enterprise-readiness-fixes.test.js](../../test/enterprise-readiness-fixes.test.js)
(F1–F4 defect tests, authored earlier and failing) now passes **10/10**
— without changing a single assertion in it.

### 1.2 New Timesheet module

```
db/timesheet/timesheet.cds                       Timesheet + TimesheetItem + TimesheetHistory
db/common/enums.cds                              TimesheetStatus, TimesheetAction
srv/timesheet/timesheet-service.cds              service + bound lifecycle actions
srv/timesheet/timesheet-security.cds             row-level @restrict (Sprint 9 roles)
srv/timesheet/timesheet-service.js               audit-hook wiring
srv/timesheet/handlers/timesheet-validation.js   CRUD guards, hours computation
srv/timesheet/handlers/timesheet-lifecycle.js    Submit/StartReview/Approve/Reject/Withdraw/Cancel/Reopen
srv/timesheet/handlers/timesheet-workflow.js     optional generic-workflow integration + callbacks
srv/timesheet/handlers/timesheet-payroll.js      payroll consumption module
srv/payroll/handlers/payroll-engine.js           calls the consumption module (same tx)
db/data/ewms.db.workflow-WorkflowDefinition.csv  seeded WF-TIMESHEET-STD (+ 1 step)
test/timesheet.test.js                           13 automated tests
```

---

## 2. Data model

| Entity | Purpose | Key fields |
|---|---|---|
| `Timesheet` | one employee's work report for ONE reporting period | `timesheetCode` (TS…, unique), `employee`, `periodFromDate/ToDate`, `status`, `regularHours`, `overtimeHours`, `assignedManager`, `submittedOn`, `reviewedBy/On/Comments`, `payrollConsumedOn`, `payrollPeriod` |
| `TimesheetItem` | one work entry: one day (+project) in the sheet | `workDate`, `employeeAssignment`, `shift`, `project`, `startTime/endTime`, `breakHours`, computed `regularHours/overtimeHours`, `notes` |
| `TimesheetHistory` | append-only approval/correction ledger | `action`, `previousStatus/newStatus`, `actor`, `actedOn`, `comments` |

No employee/project/shift/payroll master data is duplicated — only
associations. `assignedManager` is a handler-refreshed mirror of the
active `EmployeeAssignment.reportingManager` (the same pattern the
Performance module uses) so row-level manager scope is queryable.

**Hours model.** Reuses the existing conventions, invents no policy:

* worked minutes = `endTime − startTime` (endTime < startTime ⇒ the
  entry runs **overnight** and gains 24h) − breaks,
* `regularHours = min(worked, 8h)` — 8h is the standard day the
  attendance/overtime module already uses,
* `overtimeHours = max(0, worked − 8h)`,
* a `shift` reference without explicit times inherits the shift's
  own hours (including its overnight semantics).

---

## 3. Lifecycle and authorization

```
Draft ──Submit──> Submitted ──StartReview──> InReview ──Approve──> Approved
   ▲               │      │                    │
   │      Reject ──┘      └── Withdraw ───────┘        (both → Draft)
   │
   ● Cancel (from Draft/Submitted/InReview → Cancelled, final)
   ● Reopen (Approved → Draft, HR-only, blocked after payroll consumption)
```

| Rule | Enforcement |
|---|---|
| Employees create/edit only **their own** sheets | `assertSelfCreate` (shared util) + row-level `@restrict` where-clauses; colleagues' sheets are invisible to READs |
| Status never changes via PATCH | UPDATE handler rejects any `status`/`payroll*`/totals field with 400; only the bound actions transition |
| Editable only in Draft | header + item UPDATE/DELETE guards reject non-Draft edits (rejection returns the sheet to Draft, so rejection is still followed by normal editing) |
| Only in-scope managers review | approver/reviewer must be the sheet's `assignedManager` (HR admins excepted — documented fallback) and never the sheet's **owner** (self-decision impossible) |
| Duplicate submissions/approvals harmless | every action re-reads status in the CURRENT transaction and performs a **conditional UPDATE** (`WHERE status = <expected>`); zero rows changed ⇒ **409** — a retry after a committed attempt gets a clean 400/409, never a double apply |
| Approval path via generic engine (optional) | `StartWorkflow` on a Draft/Submitted sheet; callbacks sync final decisions (Approved/Cancelled), rework (→Draft) and resubmit (→Submitted). Instance/task authorization stays entirely inside the engine — no duplicated logic |
| History ledger append-only | no write grants on `TimesheetHistories` (403) + explicit before-guards; actions write single ledger rows at db level |
| Notifications | manager (submit), employee (review started/approved/rejected/reopened/consumed), manager (cancel) via the shared `notify()` core, category `TIMESHEET` |
| Audit | shared `registerAuditHooks` on Timesheets + Items, plus explicit `persistAudit` per transition and per payroll consumption |

---

## 4. Assignment / shift / roster / attendance integration

* **EmployeeAssignment (Sprint 4)** — each item's `workDate` must be
  covered by an assignment of the same employee
  (`fromDate ≤ workDate ≤ toDate|null`). When the caller does not
  pick one, the covering assignment is resolved automatically and
  becomes the item's `employeeAssignment`; its `project` becomes the
  default work attribution.
* **WorkSchedule / ShiftAssignment (Sprint 6)** — coverage rules were
  repaired this sprint (§1.1): bounded ranges no longer conflict by
  mistake, an **indefinite** assignment supersedes earlier indefinite
  ones (auto-closing the old row the day before the new start =
  valid historical continuity), and a later-starting pinned
  assignment still blocks premature indefinite ones. WorkSchedule
  duplicate checks now actually fire.
* **Attendance (Sprint 6)** — work cannot be logged on days
  attendance reports `Leave/Holiday/WeekOff/Absent`. WorkFromHome /
  OnDuty days stay valid. **Hours equality between attendance and
  timesheet is deliberately NOT enforced** — legitimate exceptions
  exist (authorized adjustments, off-site work); reconciliation is
  the manager's review job, checking the raw-rows equality was
  rejected as a policy that would remove valid exceptions.
* **SQLite verified**: all invariants above are covered by the new
  test suite running on the in-memory SQLite [test] profile.
  **HANA flag**: `transition()`'s conditional-update idiom and the
  tagged-template where-clauses are portable CQN, but HANA's stricter
  SQL (e.g. `INSERT` with `Timestamp` precision, enum storage) needs
  a textbook HANA run — flagged for the production-readiness check.

---

## 5. Payroll integration

Approved sheets flow to payroll through a **set-once consumption**
(described in [srv/timesheet/handlers/timesheet-payroll.js](../../srv/timesheet/handlers/timesheet-payroll.js)):

1. `ProcessPayroll` (existing engine, existing locking rules) calls
   `consumeApprovedTimesheets()` **inside the same per-employee
   transaction** for every approved, unconsumed sheet whose period
   intersects the payroll period.
2. Consumption sets `payrollConsumedOn` + `payrollPeriod` and writes
   a `PayrollConsumed` ledger row + audit + notification.
3. A second run finds nothing unconsumed → the same hours can never
   be counted twice. If the payroll insert fails, the consumption
   rolls back with it (atomic).
4. A consumed sheet is FROZEN: lifecycle actions and direct PATCHes
   refuse it. Corrections after payroll therefore cannot silently
   rewrite consumed work.
5. All money math stays in the Payroll module — the consumption adds
   no earnings path.

**Documented gap (deliberate):** there is no payroll *adjustment*
mechanism yet for corrections that only become visible after a
PayrollProcess was approved/consumed. Reopen is refused with a clear
message pointing to the missing adjustment feature; building one
would be an unreviewed payroll redesign and is left to a future
sprint. Consuming timesheets also never means payment occurred —
payment status remains at `PayrollProcess`/period level.

---

## 6. Automated test coverage

[test/timesheet.test.js](../../test/timesheet.test.js) — 13 tests:

draft creation/editing + computed totals (incl. overnight 22:00→08:00
with 1h break = 8 regular + 1 overtime), cross-employee denial
(create + row-level read), out-of-period + future work dates,
duplicate entries, submit→review→approve with manager scope
(out-of-scope manager 403, self-review 403, out-of-scope approve 403,
PATCH-bypass 400), rejection with mandatory reason + editable Draft,
invalid transitions (approve-from-Draft, double submit, double
withdraw, reopen-from-Draft), approved-record protection + HR reopen
before payroll, payroll single consumption + freeze + re-run without
duplication, workflow instance creation + append-only history (403),
concurrent approve race (exactly one winner; loser 400/409),
notification delivery to the real recipients.

`npm test` full suite: **179 tests / 179 pass / 0 fail / 0 skipped,
natural exit 0** (166 pre-existing + 13 new; the seed-list assertion
in the Sprint 10 regression suite was updated for the legitimately
added 4th workflow definition/5th step — assertion strength unchanged).

---

## 7. Remaining business-policy decisions & production risks

1. **Overtime standard (8h/day)** is inherited from the attendance
   module. If HR defines a different daily/overtime threshold, it
   must become shared configuration — currently a constant
   (`STANDARD_DAY_HOURS`) documented in code.
2. **No rounding/paid-break policy** — minutes are exact; a rounding
   rule (e.g. 15-minute buckets) is a policy decision, not missing code.
3. **Corrections after payroll consumption** need a payroll
   adjustment mechanism (documented gap, see §5).
4. **HANA validation** of the production profile has not been run in
   this sprint (SQLite only) — flagged, see §4.
5. **Timesheet periods may not overlap** per employee; a company
   allowing multiple parallel per-project sheets would need a scoping
   rule added (not supported today).
6. Evening/night-shift workers whose work day spans two roster dates
   are supported at the item level (overnight semantics); overnight
   *attendance* check-in/out (Sprint 6) still assumes same-day
   checkout — pre-existing behavior, untouched per sprint boundaries.
