# EWMS – Setup Guide (Beginner Friendly)

This guide explains how to get the EWMS (Enterprise Workforce Management
System) project running on your machine, how to run the automated tests,
and how the development, testing, and production environments differ.

> **You do NOT need to deploy anything** to run this project locally or
> to run the automated tests. Deployment (SAP BTP / SAP HANA Cloud) is a
> separate, optional step for later.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS or newer | Check with `node -v` |
| npm | 9 or newer | Ships with Node.js |
| VS Code | latest | Recommended editor |
| VS Code REST Client extension | optional | To run the `test/*.http` files |

You do **not** need a database server: development uses a local SQLite
file and tests use an in-memory database (both configured automatically).

---

## 2. Install Dependencies

Open a terminal in the project root (the folder containing
`package.json`) and run:

```bash
npm install
```

This installs SAP CAP (`@sap/cds`), the SQLite adapter, and all other
dependencies listed in `package.json`.

---

## 3. Start the Project Locally (Development)

```bash
npm run watch
```

or equivalently:

```bash
npm start
```

- The server starts on **http://localhost:4004**.
- Open http://localhost:4004 in a browser to see the service index page.
- The development database is the local file **`db.sqlite`**
  (created automatically on first start).

### Local development authentication

In development the project uses **mocked users** (defined in
`package.json` under `cds.requires.auth.users`). Log in with the
username and an **empty password**:

| Username | Roles | Typical use |
|----------|-------|-------------|
| `sysadmin` | SystemAdmin, HRAdmin, FinanceManager | Full access, sees compensation |
| `hrperson` | HRExecutive, HRAdmin | HR day-to-day work |
| `finmgr` | FinanceManager | Compensation visibility; seeded offer approver |
| `mgrdept` | DepartmentManager | Manager view (compensation masked) |
| `mgrproj` | ProjectManager | Project work |
| `payexec` | PayrollExecutive | Payroll work |
| `empjohn` | Employee | Plain employee (negative security tests) |

Example HTTP header for the REST Client extension:

```
Authorization: Basic sysadmin:
```

---

## 4. Run the Sprint 12–14 Tests (Offers, Onboarding, Performance, Assets)

The automated tests are real project files you can open in VS Code:

- `test/setup.js` – shared test bootstrap (starts ONE in-memory CAP
  test server via `cds.test()`; no `process.exit()`, no background
  servers left behind)
- `test/recruitment.test.js` – Sprint 12 feature + regression tests
- `test/performance.test.js` – Sprint 13 performance management tests
- `test/asset.test.js` – Sprint 14 asset management tests
- `test/timesheet.test.js` – Sprint 15 timesheet lifecycle + payroll integration tests
- `test/geo.test.js` – Sprint 16 geofence validation + privacy tests
- `test/policy.test.js` – Sprint 19 HR policy lifecycle + acknowledgment tests
- `test/helpdesk.test.js` – Sprint 20 helpdesk lifecycle + privacy + SLA tests
- `test/exit.test.js` – Sprint 21 exit-management lifecycle + clearance + integration tests
- `test/dashboard.test.js` – Sprint 22 dashboard aggregate + authorization tests
- `test/reports.test.js` – Sprint 23 reports, CSV export + filter/limit tests
- `test/jobs.test.js` – Sprint 24 background jobs: validation, authorization, idempotent re-runs, in-memory history

Run the complete suite from the project root:

```bash
npm test
```

Expected result: all tests pass and the process **exits by itself**
with exit code 0. The tests run against an **in-memory SQLite
database** (profile `[test]` in `package.json`), so they never touch
your development `db.sqlite` file.

To run only the Sprint 12 test file:

```bash
CDS_ENV=test node --test test/recruitment.test.js
```

To run only the Sprint 24 test file (background jobs):

```bash
CDS_ENV=test node --test test/jobs.test.js
```

To run one background job locally against the in-memory test profile
(safe: it deploys to a scratch in-memory database and never touches
your `db.sqlite`):

```bash
CDS_ENV=test node srv/jobs/run-job.js document-expiry --window 30
```

To schedule the jobs in the background (OFF by default - the
timer only starts when this environment variable is set, and it
NEVER starts during tests):

```bash
EWMS_JOBS_ENABLED=true EWMS_JOBS_INTERVAL=60 npm run dev
```

To run only the Sprint 13 test file (performance reviews + goals):

```bash
CDS_ENV=test node --test test/performance.test.js
```

To run only the Sprint 14 test file (asset management):

```bash
CDS_ENV=test node --test test/asset.test.js
```

To run only the Sprint 15 test file (timesheet):

```bash
CDS_ENV=test node --test test/timesheet.test.js
```

To run only the Sprint 16 test file (geofencing):

```bash
CDS_ENV=test node --test test/geo.test.js
```

---

## 5. Run the Complete Test Suite

`npm test` discovers every `test/*.test.js` file, so the command above
already runs the full automated suite (Sprint 12 + 13 + 14 + all
earlier sprints).

Manual API examples live next to the tests:

- `test/recruitment.http` – offer → onboarding → employee conversion
- `test/leave.http`, `test/payroll.http`, `test/security.http`,
  `test/organization.http`, `test/test.http`

Sprint 13 API examples (reviews + goals) are documented in
`docs/sprints/SPRINT-13.md`.

Open them in VS Code with the REST Client extension while
`npm run watch` is running.

---

## 6. Run CDS Compilation / Validation

Check that the whole model compiles cleanly:

```bash
# Full service model to CSN (exit code 0 = OK)
npx cds compile srv --to csn

# Database schema to HANA SQL (validates the production schema)
npx cds compile db --to hana

# One service to OData EDMX (one service at a time)
npx cds compile srv/recruitment/recruitment-service.cds --to edmx
```

A non-zero exit code or an error message means the model has a problem
that must be fixed before starting the server.

---

## 7. Verify the Services

While `npm run watch` is running, request the metadata of each service
(browser or `curl`). With mocked authentication you must send the
`Authorization: Basic <username>:` header, otherwise you get `401`
(which is correct – everything is protected):

```
http://localhost:4004/odata/v4/employee/$metadata
http://localhost:4004/odata/v4/leave/$metadata
http://localhost:4004/odata/v4/payroll/$metadata
http://localhost:4004/odata/v4/attendance/$metadata
http://localhost:4004/odata/v4/notification/$metadata
http://localhost:4004/odata/v4/workflow/$metadata
http://localhost:4004/odata/v4/project/$metadata
http://localhost:4004/odata/v4/team/$metadata
http://localhost:4004/odata/v4/organization/$metadata
http://localhost:4004/odata/v4/recruitment/$metadata
http://localhost:4004/odata/v4/performance/$metadata
http://localhost:4004/odata/v4/asset/$metadata
```

A `200` with XML output means the service loaded correctly.

---

## 8. Local Development Database

- Kind: **SQLite**, file `db.sqlite` in the project root
  (configured as the default `db` in `package.json`).
- Created and seeded automatically on first server start from the CSV
  files under `db/data/`.
- Safe to delete while the server is stopped – it is recreated on the
  next start. Do **not** commit it to version control.

---

## 9. Testing Environment (Isolated)

- Activated automatically by `npm test` via `CDS_ENV=test`.
- The `[test]` profile in `package.json` overrides the database to an
  **in-memory SQLite** database (`url: ":memory:"`).
- Nothing is written to disk; each test run starts from a fresh,
  seeded database.
- Authentication uses the same mocked users as development.
- The test server is started and stopped by CAP's own test lifecycle
  (`cds.test()`) – one server per test file, no manual cleanup needed.

---

## 10a. Document File Storage (Sprint 17)

Employee document files are **never** stored in the database. The DB keeps
only a storage key + SHA-256 hash; the bytes go through the storage adapter
in `srv/compliance/document-storage.js`:

- **Local development (default):** files are written to the directory
  configured by the `EWMS_DOCUMENT_STORAGE_DIR` environment variable (default:
  `<project>/document-store/`). This directory is git-ignored and is NOT
  served by any HTTP route — bytes are only retrievable through the
  authorized `Documents(...)/Download` action.
- **Production:** set `EWMS_DOCUMENT_STORAGE_DIR` to a mounted private
  volume, or plug a real object-store/HDFS adapter exposing the same
  `saveFile` / `readFile` interface. The
  local directory is explicitly not a production layout; no production
  credentials exist or are invented in this repository.
- **Malware scanning is NOT implemented** and must be added at the
  production storage boundary (e.g. scan-before-verify policy).

Details: [docs/sprints/SPRINT-17.md](docs/sprints/SPRINT-17.md).

---

## 10. Production SAP HANA Information

The `[production]` profile in `package.json` switches the database to
**SAP HANA Cloud** and authentication to **XSUAA**:

```
cds.requires.db     -> hana
cds.requires.auth   -> xsuaa
```

- Production deployment is done with the standard CAP/BTP tooling
  (MTA deployment, `cds add hana`, `cds add xsuaa`, etc.) and is **not
  required** for local development or testing.
- Never run automated tests against the production database.

---

## 11. Local vs Testing vs Production (Summary)

| Aspect | Local development | Testing | Production |
|--------|-------------------|---------|------------|
| Command | `npm run watch` | `npm test` | BTP deployment |
| Database | `db.sqlite` file | In-memory SQLite | SAP HANA Cloud |
| Auth | Mocked users (package.json) | Mocked users | XSUAA / IAS |
| Data | Persisted on disk | Gone after the run | Persisted, backed up |
| Deployment needed | No | No | Yes (separate task) |

---

## 12. Common Problems and Solutions

**`Error: Cannot find module '@sap/cds'`**
Run `npm install` in the project root.

**Port 4004 already in use**
Another server is still running. Stop it, or start on another port:
`npx cds-serve --port 4005`.

**Tests hang or never finish**
Run `npm test` again from a clean shell. The test bootstrap uses
CAP's own `cds.test()` lifecycle and must exit by itself; if you see
a hang, do not add `process.exit()` anywhere – report/inspect the
last started test instead.

**`401 Unauthorized` or `403 Forbidden` in the browser/REST Client**
That is the security layer working. Send a mocked user, e.g.
`Authorization: Basic sysadmin:` (empty password).

**`db.sqlite` looks stale or broken**
Stop the server, delete `db.sqlite`, start again – the schema and
seed data are recreated automatically.

**A background job (or other operation) fails with 500 and the log
shows `no such table: ...`**
Your `db.sqlite` predates a newer sprint's tables (it was created
before the model changed, so boot did not upgrade it). The file is
disposable seed data by design: stop the server, delete `db.sqlite`,
start again – it is recreated from `db/data/*.csv`. (Verified in the
Phase 2 audit: a stale db caused exactly this on `RunJob`; a freshly
rebuilt database fixed it. Older-user-entered development rows are
not preserved by this remedy – keep anything valuable in the seed
CSVs or a copy.)

**CDS compile error after editing a `.cds` file**
Read the first error message of `npx cds compile srv --to csn` – it
names the file and position. Fix that error before restarting.

**Candidate/offer requests return 403 for a manager**
By design: recruitment data is confidential. DepartmentManagers only
see offers where they are the reporting manager, and the offered
compensation is masked for them.

---

## 13. Start the Frontend (Sprint 26 - Fiori/UI5 Application Shell)

The frontend is a standard SAPUI5 freestyle application served directly
by the CAP server from `app/EWMS` (CAP serves everything under `app/`
automatically - no extra process needed).

### One terminal is enough

```bash
npm run watch
```

Then open the shell with seeded identity & live data in your browser:

```
http://localhost:4004/EWMS/webapp/index.html
```

For quick deep links during development (Sprint 26 + Sprint 27 screens):

- `http://localhost:4004/EWMS/webapp/index.html#/employees` - directory
- `http://localhost:4004/EWMS/webapp/index.html#/employees/<ID>` - profile
- `http://localhost:4004/EWMS/webapp/index.html#/org` - departments
- `http://localhost:4004/EWMS/webapp/index.html#/org/<ID>` - department detail
- `http://localhost:4004/EWMS/webapp/index.html#/projects` - projects
- `http://localhost:4004/EWMS/webapp/index.html#/projects/<ID>` - project detail
- `http://localhost:4004/EWMS/webapp/index.html#/teams` - teams
- `http://localhost:4004/EWMS/webapp/index.html#/teams/<ID>` - team detail (roster)

### Local dev identity picker

Because development uses CAP's **mocked users**, the shell shows a small
"Local dev identity" picker in the left panel. Picking a user and
pressing **Sign in** re-attaches that identity as HTTP Basic header on
all subsequent OData calls, and every open page re-fetches with the new
role's visibility. This picker is a **development convenience only**;
real authorization always comes from the CAP backend (`@restrict` /
`@requires`). In production this is replaced by XSUAA/IAS sign-in.

To verify role scoping yourself: sign in as `empjohn` (plain employee) -
the directory shows only your own record and the Organization screen
shows the backend's real HTTP 403 error state; `sysadmin` sees all
seeded employees, departments, projects and teams.

### How the frontend talks to the backend

- The app is served same-origin by CAP, so OData is called on relative
  paths like `/odata/v4/employee/Employees` (no proxy step).
- The service URL list is centralised in
  `app/EWMS/webapp/model/Config.js`. Add the latest service path there
  when a new screen is added.
- All reads go through `app/EWMS/webapp/model/Backend.js`, which does
  real XHR calls and rejects on error - the UI always shows loading,
  empty, or error states based on the result (never fake data).

### Renaming / re-styling later

- App identity lives in `app/EWMS/webapp/manifest.json` (title,
  description, icon) and `app/EWMS/webapp/i18n/i18n.properties`.
- Module menu entries live in `Config.js` (`nav` array). A module only
  shows as *available* when its screen and route actually exist.

### Common frontend problems

**Blank page / "failed to load resource 404" for a `.js` file?**
Check the browser console - the file path is usually a typo between the
view/controller name and the manifest route (`viewName`).

**`Refused to execute script ... Component-preload.js ... 404`**
Normal in development - no preload bundle is generated yet (UI5 falls
back to loading each file individually and works fine). A preload build
is a later optimisation, not a blocker.

**Wrong data shown after changing the picked user**
Make sure you pressed **Sign in** after changing the combo box; pages
listen for the identity change and re-fetch.

**"HTTP 403 / 404" in the error state of a screen**
Correct behavior: the frontend shows the backend's real answer. Use a
higher-privileged dev user, or fix the backend `@restrict` rule if the
role should have access.

---

## 14. Where to Go Next

- Sprint 12 feature documentation: `docs/sprints/SPRINT-12.md`
- Project overview: `readme.md`
- Automated tests: `test/recruitment.test.js`
