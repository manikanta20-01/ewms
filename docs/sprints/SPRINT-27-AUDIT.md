# Sprint 27 — Completion Audit (gate for Sprint 28)

**Audit date:** 2026-10-31
**Result: PASS — Sprint 27 is COMPLETE.** Sprint 28 may begin.

---

## 1. Documentation verified in the tree

- `docs/sprints/SPRINT-27.md` exists and documents: 8 implemented screens
  (Employee Directory/profile, Department list/detail, Project list/detail,
  Team list/detail), the real services used, the Sprint 26 gate outcome and
  the remaining-work list. Status `COMPLETE`.
- `docs/sprints/SPRINT-26-AUDIT.md` present with the Sprint 27 gate addendum,
  including the two defects found during the Sprint 27 gate and their fixes.

## 2. Frontend files verified in the tree (working-tree inspection)

`app/EWMS/webapp/` contains the Sprint 26 shell plus the Sprint 27 additions:

- Navigation (`model/Config.js`): Employees / Organization / Projects / Teams
  marked available with real routes; all later-sprint modules gated off.
- Routing (`manifest.json`): the nine-route set including
  `org/{id}`, `projects/{id}`, `teams/{id}` detail routes.
- 12 new Sprint 27 view/controller files + the 10 original shell files, all
  present and syntactically valid.

## 3. Sprint 27 screens verified live (previous session, recorded evidence)

Live browser run-through against `http://localhost:4004/EWMS/webapp/index.html`
with real CAP services:

- Employee list rendered 5 seeded rows (`sysadmin`); detail navigated and
  showed a real assignment (`Software Engineer`).
- Org list rendered 4 departments; org detail showed real BU/location and
  the linked project (`PROJ0001 EWMS HRMS · Internal · Active`).
- Project list rendered 2 projects with role-visible footer; team list
  rendered 3 teams; team detail rendered 2 real roster members.
- Role check as `empjohn`: Organization screen honest **HTTP 403** error
  state, directory shows exactly 1 own row.

## 4. Fresh regression runs for this gate (actual exit codes)

| Command | Result |
|---|---|
| `npm test` | **406 tests / 120 suites / 0 fail / 0 skipped — exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` (local compile only) | exit 0 |

No regressions found; the Sprint 27 fixes (jobs.test.js debug probe removal,
9-route manifest assertion) hold.

## 5. Known non-defects carried into Sprint 28

- Cross-service `$expand` is not supported by CAP; related entities are
  joined client-side through restriction-aware ID lookups.
- Legacy seed `status` values (`true`/"1") still surface as
  "Active (legacy seed value)" labels and make enum filters miss some rows.
- Services for the attendance domain (attendance, leave, timesheet, geo)
  exist and are authorized but have **no frontend screens yet** — that is
  Sprint 28's scope, not a Sprint 27 defect.

## 6. Gate decision

PASS — Sprint 27 complete and unblocked; proceed to Sprint 28.
