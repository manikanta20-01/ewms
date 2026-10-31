# Sprint 26 — Fiori/UI5 Foundation & EWMS Application Shell

**Status:** `COMPLETE`
**Scope:** frontend foundation only. Local development (SQLite + CAP mocked
users). No deployment, no remote operations, no Git commit/push.

---

## 1. Phase 2 verification gate (checked first, before any frontend work)

- Evidence: `docs/PHASE-2-LOCAL-VERIFICATION.md` — result
  **READY WITH NON-BLOCKING ISSUES** (400 tests / 120 suites, exit 0;
  srv→csn and db→hana compiles exit 0; the one release-blocking defect D1
  was already repaired with a regression test).
- The gate was additionally re-verified against the current working tree
  during Sprint 26, with fresh commands and exit codes:

| Command | Result |
|---|---|
| `npm test` (# tests 406, # fail 0, 120 suites) | **exit 0** |
| `npx cds compile srv --to csn` | **exit 0** |
| `npx cds compile db --to hana` (compile-only, never connects) | **exit 0** |

No critical authorization defect, no blocking regression, no missing
backend service for the planned screens. **Gate: PASS.**

---

## 2. Architecture chosen (and why)

**Freestyle SAPUI5 application served by the local CAP server from
`app/EWMS`**, with one integrated shell built on standard SAP controls:

- **`sap.f.FlexibleColumnLayout`** as the shell (begin = navigation panel,
  mid = list pages, end = detail pages), routed with
  **`sap.f.routing.Router`** — the closest standard-free-complexity pattern
  to the Fiori shell designs SAP uses today, without adding a Launchpad
  dependency this project does not have yet.
- Fiori Elements was *evaluated* but **not** used for Sprint 26: the
  project has no `@sap/ux-` tooling or flpSandbox configured, and the
  employee service is not annotated for local previews (`@ui5...` /
  lineitem/facet annotations are absent). hand-rolling half-annotations
  would have produced a worse foundation than a clean freestyle shell;
  future sprints can add annotations + FE for ordinary screens without
  replacing this shell.
- **No new npm dependencies were added.** UI5 boots from the CDN
  (`sapui5.hana.ondemand.com/1.141.0`, pinned, sap_horizon theme); CAP
  serves `app/EWMS` same-origin automatically, so no proxy and no
  build tooling is needed for development. A UI5 Tooling build/preload
  step is a later optimization, not part of this sprint.
- **Data access** goes through one facade module
  (`app/EWMS/webapp/model/Backend.js`) that calls the **real OData V4
  service** (`/odata/v4/employee/...`) with plain XHR and *rejects* on
  every non-2xx — the UI shows the honest loading/empty/error state and
  never substitutes fake data. Service paths are centralised in
  `app/EWMS/webapp/model/Config.js` (relative URLs, portable to a future
  approuter/managed-approuter production setup).
- **Identity:** development uses CAP mocked users. The shell shows a
  *"Local dev identity"* picker (the users mirror `package.json`'s
  `cds.requires.auth.users`) that attaches the Basic auth header and
  re-fetches open pages on change. This is a dev convenience only —
  **authorization always comes from the CAP backend** (`@restrict` /
  `@requires` are authoritative; the UI is not a security boundary).
  Production replaces this with XSUAA/IAS.

## 3. What was implemented

| Item | Where |
|---|---|
| Application shell + module navigation (7 modules; only Employee Directory is flagged available — no dead ends) | `app/EWMS/webapp/view/Main.view.xml`, `model/Config.js` (`nav`), `controller/Main.controller.js` |
| Routing: `#/-` (home), `#/employees`, `#/employees/{id}` | `app/EWMS/webapp/manifest.json` (FCL router), `Component.js` |
| Demo screen 1 (List): paged, searchable, real backend rows, role-scoped count | `view/EmployeeList.view.xml` + `controller/EmployeeList.controller.js` |
| Demo screen 2 (Detail): member fields + expanded assignments (designation/grade/reporting manager) | `view/EmployeeDetail.view.xml` + `controller/EmployeeDetail.controller.js` |
| Home / connection status panel (live `$count` against EmployeeService, honest error + re-check button) | `view/Home.view.xml`, `controller/Home.controller.js` |
| Session facade + dev-identity picker + sessionChanged re-fetch | `model/Backend.js`, `Component.js`, event bus channel `ewms/sessionChanged` |
| Loading / empty / error / success states | busy state in every model (`emp`, `detail`, `home`); MessageStrip error states; `noDataText`; footer counts — no fake fallback anywhere |
| Dev env specifics | `ui5-bootstrapped` index.html, CSP-safe; localStorage key `ewms.devUser` |

## 4. Live verification performed (browser, real backend on :4004)

All exercised in the running app: shell loads, picker works, list shows
10 seeded employees for `sysadmin`, **`empjohn` sees exactly 1 row**
(own record — backend role scoping proven from inside the real app),
detail + deep link (`#/employees/<id>`) renders with assignments,
switching identity re-fetches both list and open detail,
signed-out state shows an honest error instead of data, and a plain
employee opening another employee's detail gets the backend's real HTTP
404 rendered as an error message (no fake data). "Planned module" menu
entries show a message toast instead of navigating to non-existent
routes. Console errors are limited to dev-noise 404s for the (not yet
built) `Component-preload.js` and i18n locale fallbacks — documented in
`SETUP.md` §13.

## 5. Files created/modified in Sprint 26

```
app/EWMS/webapp/
  index.html
  manifest.json
  Component.js
  model/Config.js
  model/Backend.js
  view/Main.view.xml + controller/Main.controller.js
  view/Home.view.xml  + controller/Home.controller.js
  view/EmployeeList.view.xml  + controller/EmployeeList.controller.js
  view/EmployeeDetail.view.xml  + controller/EmployeeDetail.controller.js
  i18n/i18n.properties
docs/sprints/SPRINT-26.md   (this file)
SETUP.md                    (§13 — new frontend run guide)
```

No backend file was touched (compiles + full suite re-run as proof).

## 6. Commands to run everything locally

```bash
# Backend + frontend in one process (both are same-origin locally)
npm run watch
# open http://localhost:4004/EWMS/webapp/index.html

# Full backend regression
npm test                          # 406/406 green, exit 0

# Model/contract validity
npx cds compile srv --to csn      # exit 0
npx cds compile db --to hana      # exit 0 (compile only, never connects)
```

## 7. Future production compatibility (declared, not claimed)

- The app uses **relative** service URLs only; a future approuter /
  managed-approuter must route `/odata/v4/*` to the backend — no code
  change needed, just routing config.
- The dev-identity picker must be removed/gated by environment in
  production; session handling replaces it with XSUAA/IAS.
- Not everything local proves production: a UI5 Tooling build step,
  `@sap/ux-specification`/FE previews, preload bundle generation, and
  live HANA/XSUAA behavior are deliberately deferred and must not be
  inferred from this sprint.

## 8. Remaining work for later sprints (deliberately not done here)

- One module screen per later sprint (Attendance, Payroll, Workflow
  approvals, Timesheet, Documents, Reports/dashboards) — backend
  services exist; the frontends must read from `Config.js` + `Backend.js`.
- Fiori floorplans migration for ordinary list/object screens once
  annotations exist.
- UI5 Tooling build (preload), i18n en extras, and a firewall-solid E2E
  test harness.

**No deployment, no remote server operation, no remote HANA connection,
no Git commit, and no Git push occurred in Sprint 26.**
