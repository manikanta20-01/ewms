# Sprint 27 — Organization, Employees, Projects & Teams UI

**Status:** `COMPLETE`
**Scope:** first consolidated business-screen group on the Sprint 26 Fiori/UI5
foundation. Local development only (SQLite + CAP mocked users). No deployment,
no remote operations, no Git commit/push.

---

## 1. Sprint 26 gate (see `docs/sprints/SPRINT-26-AUDIT.md`)

Result **PASS**, after two verified defects were fixed first:

| Item | Evidence |
|---|---|
| `npm test` (first run this sprint) | 391 tests / **2 fail** / exit 1 |
| → defect 1 | `test/jobs.test.js` line 1 loaded a non-existent debug probe (`/tmp/probe-diag.js`) — removed, no assertions changed |
| → defect 2 | `test/frontend.test.js` manifest test hardcoded the 3 shell routes — extended to the 9-route set (targets still checked) |
| `npm test` (after fixes) | **406 tests / 120 suites / 0 fail / 0 skipped — exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` (compile only, no server connection) | exit 0 |
| Live checks | services reachable on `http://localhost:4004`; app served at `/EWMS/webapp/index.html` |

## 2. Screens implemented (all backed by real services)

One integrated app, one shell — no new application shell was created. Every
screen is a standard SAPUI5 `sap.f.FlexibleColumnLayout` page reusing the
Sprint 26 layout, routing, session handling and state patterns.

| Screen | Route | Service / entity | Notes |
|---|---|---|---|
| Employee Directory (list) | `#/employees` | `EmployeeService/Employees` | server-side `$search`, `$filter` (employmentType, status), role-scoped count |
| Employee profile (detail) | `#/employees/{id}` | `Employees({id})?$expand=assignments(...)` | shows designations, grade, reporting manager, project/team IDs joined via lookup helpers |
| Department list | `#/org` | `OrganizationService/Departments` `$expand=businessUnit,location` | search + status filter; HR-role data |
| Department detail | `#/org/{id}` | `Departments({id})` + `Projects?$filter=department_ID eq {id}` | real parent BU/location, projects linked through the actual `department_ID` association |
| Project list | `#/projects` | `ProjectService/Projects` | search, status filter, real client/dates |
| Project detail | `#/projects/{id}` | `Projects({id})` + `Teams?$filter=project_ID eq {id}` | teams linked via the actual association |
| Team list | `#/teams` | `TeamService/Teams` | search; project joined via ID lookup |
| Team detail | `#/teams/{id}` | `Teams({id})` + `EmployeeService/EmployeeAssignments?$filter=team_ID eq {id}$expand=employee,designation,grade` | real roster rows or honest empty state |

Floorplan note: the Sprint 26 foundation uses the standard *freestyle* UI5
`FlexibleColumnLayout` shell (three-column master/detail), which is the SAP
pattern these four data groups fit; Fiori Elements list-report floorplans were
not introduced because the services are plain projections on different
services (no cross-service navigation; see limitations). No custom controls
were invented — only `sap.m`/`sap.f`/`sap.ui.layout` standard controls.

## 3. Services, actions, authorization

- Service paths come from `Config.js` only (relative, same-origin):
  `/odata/v4/{employee,organization,project,team}/`.
- **No backend create/edit/assignment actions exist** on these entities
  (plain projections; the earlier audit confirmed no bound actions). Screens
  therefore ship read/detail only — no write UI was faked.
- Authorization stays on the CAP backend. Live-verified this sprint:
  - `empjohn` (plain Employee): Organization screen shows the real
    **HTTP 403** error state; directory shows **exactly 1 own row**;
    project/team screens load (readable to all signed-in roles).
  - `sysadmin`: 10 employees, 4+ departments, 2 projects, 3 teams with rosters.
- Assignment/membership reads (`EmployeeAssignments`) are
  HR/manager-only per `@restrict`; the UI renders the backend 403 as a
  visible error or empty state — never fake rows.

## 4. Files

**Added (12):** `view/OrgList|OrgDetail|ProjectList|ProjectDetail|TeamList|TeamDetail.view.xml`
and matching `controller/…controller.js` in `app/EWMS/webapp/`.

**Modified (7 app files):**
`manifest.json` (6 new routes + targets), `Main.controller.js` (layout:
`ThreeColumnsMidExpanded` for all four detail routes), `model/Config.js`
(4 nav entries marked available + D1 note stays unchanged), `model/Backend.js`
(generic `_readList`/`_buildQueryString` helpers + department/project/team/
assignment read helpers + restriction-aware ID lookups),
`view/EmployeeList|EmployeeDetail.view.xml` and their controllers
(assignment lines honoring the shared helpers).

**Test/docs:** `test/frontend.test.js` (route set extended), `test/jobs.test.js`
(debug probe line removed), this file, `SPRINT-26-AUDIT.md` addendum,
`SETUP.md` (deep links for the new routes).

**Dependencies added:** none (backend) / none (frontend — UI5 loads from the
pinned SAPUI5 CDN already used in Sprint 26).

## 5. Verification results

| Check | Result |
|---|---|
| Frontend syntax (all 26 JS/Controller files, `node -e "new Function(...)"`) | pass |
| `npm test` (backend incl. `test/frontend.test.js`) | **406 / 406 pass — exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` | exit 0 |
| Live browser run-through | all 4 groups + detail navigation + role gating verified |

## 6. Commands

```bash
npm run watch            # one terminal: backend + app on http://localhost:4004
# open  http://localhost:4004/EWMS/webapp/index.html
npm test                 # all suites incl. frontend structural tests
```

## 7. Known limitations & remaining work

- **Cross-service navigation is not exposed by CAP**, so department→projects,
  project→teams, team→members are joined client-side via ID lookups; a role
  that cannot read the referenced rows shows "—"/honest error.
- **Legacy seed status values** (`true`/"1" instead of enum texts) still make
  enum status filters return 0 rows for some seeded records (labels show
  "Active (legacy seed value)").
- Screens are read-only because no write actions exist on these services yet.
- Remaining modules for later sprints: attendance/leave, payroll, workflow/
  approvals, timesheets, documents/compliance, reports/dashboards (still
  listed as unavailable in the nav; no fake screens).
- Production note: unchanged from Sprint 26 — relative same-origin OData paths
  work behind an approuter; mocked users must be replaced by XSUAA/IAS;
  nothing here assumes SQLite specifics.

## 8. Local-only confirmation

No deployment, upload, remote server operation, HANA connection, Git commit
or push occurred in Sprint 27. The HANA compile is a local text compilation
only (`npx cds compile db --to hana`).
