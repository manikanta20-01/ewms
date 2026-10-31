# Sprint 22 — Dashboard & Analytics

Backend-only module: computed, aggregate-only analytics over the
EXISTING module tables. There is no new metric table - every entity is
`@cds.persistence.skip` and every number is computed at read time by
the shared `srv/common/utils/analytics-queries.js` helpers, which the
Sprint 23 Reports/Export service reuses (one source of metric truth).

**Audit outcome (docs/sprints/SPRINT-22-AUDIT.md):** at the Sprint 23
gate the repository contained NO Sprint 22 implementation, so the
sprint was implemented here as the verified blocking gap, per the
"fix verified Sprint 22 gaps" rule. Baseline before work: full suite
345/345 pass (Sprints 1-21), both CDS compiles exit 0.

---

## 1. Data model / entities (all computed, none stored)

`DashboardService` (`/odata/v4/dashboard`, `srv/dashboard/`):

| Entity | Meaning | Source tables |
|---|---|---|
| `WorkforceStatus` | employees by master status | Employee |
| `HeadcountByDepartment` | active/inactive headcount per department | Employee + latest EmployeeHistory per employee + Department |
| `LeaveTypeUsage` | requests per leave TYPE: total / inProgress / approved / rejected / cancelled / approvedDays | LeaveType + LeaveRequest |
| `AttendanceByStatus` | attendance rows per AttendanceStatus | Attendance |
| `RecruitmentFunnel` | stage counts for Candidates, Offers, OnboardingCases | Candidate, Offer, OnboardingCase |
| `PerformanceStatus` | stage counts for Reviews and Goals | PerformanceReview, PerformanceGoal |
| `AssetSummary` | assets per AssetStatus + ACTIVE assignment count | Asset, AssetAssignment |
| `HelpdeskSummary` | tickets by Status and by Priority | HRTicket |
| `ExitSummary` | exit cases by Status and by ExitType | ExitCase |
| `DocumentExpiryOverview` | Active+expiry documents per type: active / expiring / expired | Document + ACTIVE DocumentRequirement config |

Metric definitions that matter (beginner notes):

- **Headcount** counts DISTINCT employees per department; department =
  the employee's LATEST `EmployeeHistory` row (the repo-wide rule used
  by the helpdesk/policy modules). Counting sets of employee IDs makes
  double counting impossible even with several assignments/rows.
- **Leave approved** = `HRApproved` (the current workflow's final
  stage) OR the legacy seed value `Approved`, so approvals can never
  be silently reclassified as "in progress" by data-vocabulary drift.
  Intermediate stages (Draft/Pending/Team/ProjectApproved) count as
  inProgress; Rejected/Cancelled keep own columns.
- **Document expiry** reuses the Sprint 17 rule with CONFIGURED
  windows: `expiry < today` = expired; `expiry <= today + alertDays of
  the type's ACTIVE requirement` = expiring. A type with no configured
  alert window has NO "expiring" bucket - nothing is invented.
- **Dates** are plain ISO strings; "today" = the UTC date (SQLite has
  no timezone concept; the decision is documented in SPRINT-23.md).

## 2. Security

`dashboard-security.cds`: READ for the HR/finance/management roles +
SystemAdmin; plain employees are denied (aggregates are still
organizational information, same line-of-sight family as the Sprint
17/19/20 reporting surfaces). Because computed entities cannot carry
row policies, every handler RE-CHECKS the roles server-side (same
belt-and-suspenders pattern as the helpdesk OverdueTickets handler).
Sensitive personal content (salaries, reasons, document bytes, personal
rows) never appears in any metric.

## 3. Tests (`test/dashboard.test.js`)

11 tests / 2 suites (targeted: **11/11 pass, exit 0**):

- authorization: a plain employee gets 403 on EVERY dashboard entity;
  management roles read 200.
- metric correctness vs INDEPENDENT raw SQL: each entity is compared
  against direct SQLite aggregations computed inside the test (not via
  the shared helpers), incl. the DISTINCT-employee headcount rule, the
  leave bucket rule (legacy `Approved` joins `HRApproved`), funnel and
  status counts per source/stage, ACTIVE asset assignments, helpdesk
  status/priority counts, exit status/type counts, and the
  configured-window expiry overview.

## 4. Verification evidence

| Check | Result |
|---|---|
| `test/dashboard.test.js` targeted | **11/11 pass, exit 0** |
| Full `npm test` after Sprint 22 | **356 tests / 108 suites: 356 pass, 0 fail, exit 0** (natural termination) |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` | exit 0 |

## 5. Files added / changed

- `srv/dashboard/dashboard-service.cds` - 10 computed entities,
- `srv/dashboard/dashboard-security.cds` - role grants,
- `srv/dashboard/dashboard-service.js` - impl wiring,
- `srv/dashboard/handlers/dashboard-reader.js` - computed READ handlers,
- `srv/common/utils/analytics-queries.js` - the shared metric helpers,
- `srv/services.cds` - serve DashboardService + security,
- `test/dashboard.test.js` - the targeted suite,
- `docs/sprints/SPRINT-22-AUDIT.md`, `docs/sprints/SPRINT-22.md`.

## 6. Limitations (documented)

1. Fixed org-structure edge cases (employee without EmployeeHistory)
   simply do not appear in headcounts - no invented bucket.
2. "Inactive" matching follows the delegations-module precedent
   (only the literal `Inactive` counts as inactive; seed data stores a
   legacy truthy value that counts as active).
3. SQLite target; HANA runtime profile remains untested (standing
   project limitation).
4. No UI in this sprint; Fiori consumption guidance lives in
   SPRINT-23.md.

## 7. Final status: **COMPLETE**

Local-only: no deployment, no remote server, no HANA connection, no
Git commit/push was performed.
