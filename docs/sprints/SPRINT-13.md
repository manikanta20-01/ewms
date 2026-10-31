# Sprint 13 — Performance Management

**Status:** ✅ Completed

Sprint 13 adds employee **performance reviews** and **performance goals**
to EWMS. Like every sprint, it reuses the existing building blocks —
Employee Core, the generic Workflow Engine (Sprint 10), the shared
Notification core (Sprint 11/12), the shared Audit helper (Sprint 9)
and the Sprint 9 role model. No new engines, no new databases, no UI.

---

## 1. Purpose

HR creates a **performance review** for an employee (the *review
subject*). An assigned **reviewer** (usually the manager) evaluates the
employee, records an overall rating and comments, and submits the
evaluation. The evaluation result is then **approved** through the
existing generic workflow engine and finally **completed** (frozen) by
HR. Alongside reviews, managers/HR assign **performance goals** that a
review can reference and evaluate.

## 2. Architecture

```
db/performance/performance.cds        entities (no employee data duplicated)
srv/performance/performance-service.cds      OData V4 service + actions
srv/performance/performance-security.cds     declarative @restrict (Sprint 9 roles)
srv/performance/performance-service.js       audit hook registration
srv/performance/handlers/review-lifecycle.js review state machine + workflow callbacks
srv/performance/handlers/goal-lifecycle.js   goal state machine
db/common/enums.cds                   new shared enums (statuses, rating scale)
db/data/ewms.db.workflow-*.csv        seeded WF-REVIEW-STD definition + step
test/performance.test.js              42 automated tests (sections A–J)
```

### Entities

| Entity | Key fields | Notes |
|---|---|---|
| `PerformanceReview` | `reviewCode` (REV…), `employee`, `reviewer`, `reviewType`, `periodStart/End`, `startDate`, `dueDate`, `status`, `overallRating`, `employeeComments`, `reviewerComments`, `finalComments`, `submittedAt`, `completedAt` | `employee` and `reviewer` are associations to the EXISTING Employee entity |
| `PerformanceGoal` | `goalCode` (GOAL…), `employee`, `assignedBy`, `title`, `category`, `weight` (0–100], `target`, `measurementCriteria`, `dueDate`, `status`, `achievement`, `rating`, comments, `completedAt` | optional `review` association — a review evaluates its goals without copying any goal data |

### Shared enums (db/common/enums.cds)

- `PerformanceReviewStatus`: `Draft, PendingReview, InReview, Submitted, Approved, Completed, Cancelled`
- `PerformanceGoalStatus`: `Draft, Active, Completed, Cancelled`
- `PerformanceRating` (the controlled 1–5 scale):
  `Unsatisfactory (1), NeedsImprovement (2), MeetsExpectations (3), ExceedsExpectations (4), Outstanding (5)`
- `PerformanceReviewType`: `Annual, HalfYearly, Quarterly, Probation, Project`

CDS itself rejects writes with invalid enum values; the handlers
additionally validate the rating strings passed to actions.

## 3. Review lifecycle

```
Draft ──SubmitReview──▶ PendingReview ──StartReview──▶ InReview
                                                          │
                                  SubmitEvaluation ──▶ Submitted
                                                          │
                        (generic workflow WF-REVIEW-STD)  ▼
                             task approval ────────▶  Approved
                                                          │
                                     CompleteReview ──▶ Completed   (frozen)

Cancelled: reachable from Draft / PendingReview / InReview / Submitted
           via CancelReview (HR only).
```

Rules enforced in code (all other transitions → HTTP 400):

- Status can **never** be changed with a plain `PATCH` — only the
  bound actions move the status.
- `StartReview` / `SubmitEvaluation` are for the assigned **reviewer**
  (or HR) — enforced by `@restrict ... where: 'reviewer_ID = $user.employeeId'`.
- `SubmitEvaluation` **requires** a valid `overallRating` (the 1–5 scale).
- `overallRating` can only be set while the review is `InReview` or
  `Submitted` (never silently from a Draft PATCH).
- `Approved`, `Completed` and `Cancelled` reviews are **frozen** — no
  edits at all (they are historical records).
- Duplicate protection: at most one **open** review per employee +
  type + identical period (HTTP 409 on a second attempt).
- No self-review: `employee === reviewer` is rejected.
- Date sanity: `periodEnd ≥ periodStart`, `dueDate ≥ period start`,
  `startDate` not in the past.

## 4. Goal lifecycle

```
Draft ──ActivateGoal──▶ Active ──CompleteGoal──▶ Completed (frozen)
  │                      │
  └──CancelGoal──▶ Cancelled ◀──CancelGoal──┘
```

- `weight` must be > 0 and ≤ 100 (validated on create AND update).
- `dueDate` cannot be in the past on create.
- A goal linked to a review must belong to the same employee as the
  review (no cross-person evaluation).
- Direct `PATCH` of the status is rejected — use the actions.

## 5. Workflow integration (reuses Sprint 10)

- `SubmitReview` starts the generic engine:
  `engine.startWorkflow(req, { businessObjectType: 'ewms.db.performance.PerformanceReview', ... })`.
- The seeded definition **WF-REVIEW-STD** (db/data CSVs) routes step 1
  to the **LevelHR** approver — the same resolution used by Leave and
  Offers. No new workflow code.
- Business callbacks (registered in `review-lifecycle.js` via
  `registerCallbacks`) keep the review and the workflow consistent:
  - instance **Approved** → review `Approved`
  - instance **Rejected** → review back to `Draft` (fix + resubmit)
  - instance **Cancelled** → review `Cancelled`
  - **SendBack** → `Draft`; **Resubmit** → `PendingReview`
- The engine enforces task access (assignee/delegate only), the
  self-approval ban and mandatory rejection comments.
- The direct HR fallback `ApproveReview` is **blocked with HTTP 409**
  while a workflow instance is still running (one authority at a time).

## 6. Authorization (reuses Sprint 9)

Declared in `performance-security.cds` — no handler-level security
framework:

| Who | Reviews | Goals |
|---|---|---|
| HRExecutive / HRAdmin / SystemAdmin | full CRUD + all actions | full CRUD + all actions |
| Assigned reviewer (`reviewer_ID = $user`) | READ, StartReview, SubmitEvaluation | — |
| Review subject (`employee_ID = $user`) | READ own, AddEmployeeComments | READ own |
| Goal assignee (`assignedBy_ID = $user`) | — | READ, Activate/Complete/CancelGoal |
| Everyone else | **no rows** (row-level where clauses) | **no rows** |

A plain employee therefore cannot even list a colleague's performance
data — an unauthorized single-ID read returns 404, and lifecycle
actions return 403.

## 7. Notification integration (reuses the shared core)

All hooks call the one shared `notify(...)` helper with category
`PERFORMANCE`. Sent on: review assigned/submitted (→ reviewer), review
approved / completed / cancelled (→ employee), goal activated (→ goal
owner). No new notification infrastructure, no background jobs — a
future "goal approaching due date" reminder would be a Background Jobs
extension point (documented, deliberately not built here).

## 8. Audit integration (reuses the shared helper)

Every lifecycle action calls `persistAudit(req, "UPDATE", "Reviews"/
"Goals", before, after)`; generic CRUD is covered by the standard
`registerAuditHooks` opt-in list (`Reviews`, `Goals`). Audit rows are
readable via the existing SystemAdmin-only `AuditLogs` projection.

## 9. API usage (OData V4)

Service root: `/odata/v4/performance` (mock auth:
`Authorization: Basic hrperson:`).

```
POST   /Reviews                                     create draft review
POST   /Reviews(ID=...)/PerformanceService.SubmitReview       start workflow
POST   /Reviews(ID=...)/PerformanceService.StartReview        reviewer
POST   /Reviews(ID=...)/PerformanceService.SubmitEvaluation   body: { overallRating, comments }
POST   /Reviews(ID=...)/PerformanceService.AddEmployeeComments body: { comments }
POST   /Reviews(ID=...)/PerformanceService.ApproveReview      HR fallback (409 while workflow runs)
POST   /Reviews(ID=...)/PerformanceService.CompleteReview     HR; freezes the review
POST   /Reviews(ID=...)/PerformanceService.CancelReview       HR; from any non-final state
POST   /Goals                                       create draft goal
POST   /Goals(ID=...)/PerformanceService.ActivateGoal
POST   /Goals(ID=...)/PerformanceService.CompleteGoal  body: { achievement, rating }
POST   /Goals(ID=...)/PerformanceService.CancelGoal
```

## 10. Testing

`test/performance.test.js` — 42 tests, one shared `cds.test()` harness
via `test/setup.js`, in-memory `[test]` database, mock users:

- **A** model/CRUD (6) **B** authorization incl. cross-employee
  protection (6) **C** goal lifecycle (5) **D** review lifecycle (4)
  **E** workflow integration incl. unauthorized approvals (4)
  **F** ratings (4) **G** validation (8) **H** audit (1)
  **I** notifications (2) **J** regression smoke (2).

Run everything (Sprint 12 + 13 + all earlier suites):

```bash
npm test          # 73 tests, 0 failures, exits naturally with code 0
```

Run only the Sprint 13 file:

```bash
CDS_ENV=test node --test test/performance.test.js
```

No deployment is involved anywhere — SQLite locally, in-memory for
tests, HANA/XSUAA only for the (untouched) `[production]` profile.
