# Sprint 26 — Completion Audit (gate for Sprint 27)

**Audit date:** 2026-10-27
**Result:PASS — Sprint 26 is COMPLETE and unblocked.** Sprint 27 may begin.

> **Sprint 27 gate addendum (re-verification, 2026-10-31).** Before starting
> Sprint 27 screens the audit was re-run against the current tree. The first
> `npm test` run reported **391 tests / 2 failures / exit 1**, caused by two
> verified defects: (1) `test/jobs.test.js` loaded a leftover diagnostic probe
> `require("/tmp/probe-diag.js")` on line 1, which no longer exists and made the
> whole jobs suite un-loadable — that debug line was removed (no assertion
> touched); (2) the Sprint 26 frontend manifest test hardcoded the original
> three shell routes, while Sprint 27 legitimately adds the org/project/team
> list+detail routes — the assertion was extended to the full nine-route set
> (targets still asserted). After the fixes: `npm test` = **406 tests / 120
> suites / 0 fail / 0 skipped — exit 0**; both compile checks exit 0 again.
> Live Screen-27 gate checks in this session: services on `http://localhost:4004`
> (fixed port), frontend served at `/EWMS/webapp/index.html`, Employee, Org,
> Project, Team screens all connected to real OData data, and the plain
> employee role (`empjohn`) got the honest HTTP 403 error state on the
> Organization screen and exactly one row in the directory. Gate result:
> **PASS — Sprint 27 proceeded.**

---

## 1. What was audited (repository evidence, not claims)

- Working tree inspected: Sprint 26 app intact under `app/EWMS/webapp/`
  (14 files: `manifest.json`, `Component.js`, `model/Config.js`,
  `model/Backend.js`, 4 views + 4 controllers, `i18n/i18n.properties`,
  `index.html`). No second shell exists; `SETUP.md` documents the run flow.
- `docs/sprints/SPRINT-26.md` reviewed: architecture, demo screens, and
  verification claims match the code present in the tree.
- Backend capability probes for Sprint 27 were run live against the
  local CAP server (SQLite dev profile, port 4004, mocked users):

| Probe (live) | Result |
|---|---|
| `GET /EWMS/webapp/index.html` | 200 — app is served by CAP |
| `GET /odata/v4/employee/$metadata` (any role) | 200 |
| `GET /odata/v4/organization/$metadata` | 200 (/org… path confirmed) |
| `GET /odata/v4/project/$metadata`, `/odata/v4/team/$metadata` | 200 |
| `Departments?$expand=businessUnit,location` (sysadmin) | 200, seeded rows |
| `EmployeeAssignments?$filter=team_ID eq …` (sysadmin) | 200, count works |
| `Employees?$filter=employmentType eq 'Permanent'` | 200, filtered count |
| `EmployeeAssignments?$top=1` as plain employee (`empjohn`) | **403** — row-level read grant enforced |
| Cross-service `$expand` `Projects?department(...)` | 400 — navigation not exposed (see §4) |

## 2. Backend regression & compilation (this audit, fresh runs)

| Command | Result |
|---|---|
| `npm test` | **406 tests / 120 suites, 0 fail, 0 skipped — exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` (compile-only, no server) | exit 0 |

## 3. Frontend verification (Sprint 26 screens, live browser session)

Recorded during Sprint 26 and re-confirmed this audit with the same
server: shell loads, dev-identity picker signs in, Employee Directory
lists 10 rows for `sysadmin` and **exactly 1 row for `empjohn`**
(backend role scoping), detail + deep links work, identity switch
re-fetches open pages, signed-out state shows an honest error, plain
employee cannot open another employee's detail (backend 404 rendered as
error), and "later sprint" menu entries never navigate to missing routes.
Console noise is limited to the documented dev-only
`Component-preload.js` 404 and i18n locale fallbacks (SETUP.md §13).

## 4. Known facts relevant to Sprint 27 (verified, not defects)

1. **Cross-service navigation is not exposed by CAP.** e.g.
   `Projects?$expand=department(...)` returns 400 because `Department`
   is served by `OrganizationService`, not `ProjectService`; same for
   `EmployeeAssignments.project/team`. The frontend therefore joins
   related entities client-side via ID lookups, with honest
   "restricted / unknown" display when the acting role cannot read the
   referenced data. **No silent fallback to mock data.**
2. `EmployeeAssignments` READ is limited to DepartmentManager,
   ProjectManager, HRExecutive, HRAdmin, SystemAdmin (`@restrict`).
   Screens showing team/project membership must handle the plain-
   employee 403 as a visible, honest state.
3. Seed CSVs carry legacy boolean-ish `status` values on some rows, so
   enum filters like `status eq 'Active'` can legitimately return 0
   rows (already visible in Sprint 26's "Active (legacy seed value)"
   labels). Documented behavior, not a new defect.
4. No create/edit/assignment **actions** exist on Project/Team/Department
   entities (plain projections; CRUD restricted to HRAdmin/SystemAdmin
   for org entities and ProjectManager/HRAdmin/SystemAdmin for
   project/team). Sprint 27 therefore ships read/browse screens plus the
   existing employee screens; write forms are deferred until the backend
   exposes dedicated use-case actions — nothing is faked in the meantime.

## 5. Gate decision

All Sprint 26 requirements verified against live evidence; regression and
compilation green; frontend runtime healthy. **Proceed to Sprint 27.**
