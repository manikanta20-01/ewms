# Sprint 15 Audit — Checklist Completion Evidence

*(Produced during Sprint 16's mandatory pre-check: "verify Sprint 15
before starting Sprint 16." All reproductions ran on the finished
Sprint 15 code in this repository.)*

## Verification commands (as run in this audit)

| Command | Exit code | Result |
|---|---|---|
| `npm test` (full suite, `CDS_ENV=test`) | 0 | **179 tests / 179 pass / 0 fail / 0 skipped** (Sprint 15 code) |
| `npx cds compile srv --to csn` | 0 | 506 KB CSN, exit 0 |
| `npx cds compile db --to hana` | 0 | 48 KB HANA DDL, exit 0 |
| `CDS_ENV=test node --test test/timesheet.test.js` | 0 | 13/13 |
| `CDS_ENV=test node --test test/regression-s1-11.test.js` | 0 | 10/10 |

The exit code of the filtered `npm test` run was re-verified with
`set -o pipefail` so the recorded exit status belongs to `npm test`
itself, not to the output filter.

## Requirement-by-requirement status

| # | Sprint 15 requirement | Status | Evidence |
|---|---|---|---|
| 1 | Timesheet data model: employee/assignment relationships, work dates, hours, project/team references | **PASS** | [db/timesheet/timesheet.cds](../db/timesheet/timesheet.cds): `Timesheet` header + `TimesheetItem` per day (+ optional `project`, `shift`, `EmployeeAssignment`). No duplicated master data — only associations. |
| 2 | Draft/submit/review/approve/reject + correction & reopen transitions | **PASS** | 8 bound actions in [timesheet-service.cds](../srv/timesheet/timesheet-service.cds); transitions implemented in [timesheet-lifecycle.js](../srv/timesheet/handlers/timesheet-lifecycle.js) with conditional updates (`WHERE status = expected`). |
| 3 | No direct-PATCH bypass; no invalid transitions | **PASS** | Direct `status` PATCH rejected with 400 (`test/timesheet.test.js` "Third-party PATCH of the status is blocked"); duplicate submit/withdraw/approve sequences proven idempotent. |
| 4 | Self-access, no self-approval, manager scope | **PASS** | Row-level `@restrict` in [timesheet-security.cds](../srv/timesheet/timesheet-security.cds) + self-write guard for CREATE + 403 for the owner on `StartReview`; manager scope via `assignedManager_ID = $user.employeeId` (in-scope vs out-of-scope manager tests). |
| 5 | Integration with EmployeeAssignment / ShiftAssignment / WorkSchedule / Attendance | **PASS** | Items validated against the assignment covering `workDate`; attendance reconciliation blocks `Leave/Holiday/WeekOff/Absent` days (timesheet-lifecycle.js). |
| 6 | Date validation, conflicting entries, overnight shifts | **PASS** | Work date outside period → 400; duplicate date → 400; overnight `endTime < startTime` computes +24h ("overnight entries cross midnight" test: 22:00→08:00 −1h break = 8 regular + 1 overtime). |
| 7 | Approved-hours into Payroll; no double counting | **PASS** | `ProcessPayroll` consumes each approved sheet once ([timesheet-payroll.js](../srv/timesheet/handlers/timesheet-payroll.js)); re-processing the period does not duplicate (paid test). |
| 8 | Payroll period locking & correction handling | **PASS** | Consumed sheets are frozen three ways (lifecycle actions, reopen, direct PATCH all refuse); corrections require HR reopen **before** consumption — after consumption documented as a gap (see §Limitations). |
| 9 | Workflow / notification / audit integration | **PASS** | Optional multi-step approval on the Sprint 10 engine (`WF-TIMESHEET-STD` seeded); notifications via the shared `notify()` (recipient-scoped inbox asserted in tests); audit via `registerAuditHooks`. |
| 10 | DB integrity, retries, concurrency | **PASS** | Concurrency test: two racing `Approve` calls → exactly one 200, the other 400/409; history ledger append-only enforced. |
| 11 | SQLite tests + HANA compilation | **PASS** | See command table; HANA compilation exits 0. (HANA *runtime* not exercised — see limitations.) |
| 12 | Documentation & beginner-friendly business rules | **PASS** | [SPRINT-15.md](SPRINT-15.md) + central guide; rule comments in the handlers are written for readers without CAP background. |

**Final Sprint 15 status: COMPLETE** (verified before any Sprint 16 work began).

## Limitations accepted in Sprint 15 (documented, not gaps in code)

- Overtime standard 8h/day inherited from attendance (constant).
- No rounding/paid-break policy (deliberate, policy decision).
- Corrections after payroll consumption await a payroll-adjustment mechanism.
- HANA production profile untested at runtime (SQLite `[test]` profile only).
- One active sheet per employee per period (no parallel per-project sheets).
