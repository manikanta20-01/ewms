# EWMS Complete System Guide

**Enterprise Workforce Management System — full backend documentation**

Last verified against the repository: automated test suite = **399 tests / 119 suites, 0 fail, 0 skipped, exit 0** (verified through Sprint 24); `npx cds compile srv --to csn` and `npx cds compile db --to hana` both exit 0.

> **Navigation tip:** every file path in this guide is relative to the project root. Links point to real files (or headings inside this document).

---

## Table of contents

1. [What is EWMS?](#1-what-is-ewms)
2. [System architecture](#2-system-architecture)
3. [Environments and configuration](#3-environments-and-configuration)
4. [Authentication and identity](#4-authentication-and-identity)
5. [Module-by-module documentation (Sprints 1–24)](#5-module-by-module-documentation)
   - [Sprint 1 – Common foundation](#51-sprint-1--common-foundation)
   - [Sprint 2 – Organization](#52-sprint-2--organization)
   - [Sprint 3 – Employee core](#53-sprint-3--employee-core)
   - [Sprint 4 – Employee profile details](#54-sprint-4--employee-profile-details)
   - [Sprint 5 – Attendance](#55-sprint-5--attendance)
   - [Sprint 6 – Leave management](#56-sprint-6--leave-management)
   - [Sprint 7 – Payroll](#57-sprint-7--payroll)
   - [Sprint 8 – Payroll period lifecycle](#58-sprint-8--payroll-period-lifecycle)
   - [Sprint 9 – Security and authorization](#59-sprint-9--security-and-authorization)
   - [Sprint 10 – Generic workflow engine](#510-sprint-10--generic-workflow-engine)
   - [Sprint 11 – Notifications](#511-sprint-11--notifications)
   - [Sprint 12 – Recruitment and onboarding](#512-sprint-12--recruitment-and-onboarding)
   - [Sprint 13 – Performance management](#513-sprint-13--performance-management)
   - [Sprint 14 – Asset management](#514-sprint-14--asset-management)
   - [Sprint 15 – Timesheet, Shift & Roster Integration](#515-sprint-15--timesheet-shift--roster-integration)
   - [Sprint 16 – Geo Tracking & Geo-Fencing](#516-sprint-16--geo-tracking--geo-fencing)
   - [Sprint 17 – Documents & Compliance](#517-sprint-17--documents--compliance)
   - [Sprint 18 – Employee Engagement](#518-sprint-18--employee-engagement)
   - [Sprint 19 – HR Policy Management](#519-sprint-19--hr-policy-management)
   - [Sprint 20 – HR Support / Helpdesk](#520-sprint-20--hr-support--helpdesk)
   - [Sprint 21 – Exit Management](#521-sprint-21--exit-management)
   - [Sprint 22 – Dashboard & Analytics](#522-sprint-22--dashboard--analytics-implemented)
   - [Sprint 23 – Reports & Export](#523-sprint-23--reports--export-implemented)
   - [Sprint 24 – Background Jobs & Scheduled Processing](#524-sprint-24--background-jobs--scheduled-processing-implemented)
   - [Planned modules (Sprint 25+, not implemented)](#525-planned-modules-not-implemented)
6. [Permissions and security matrix](#6-permissions-and-security-matrix)
7. [End-to-end business workflows](#7-end-to-end-business-workflows)
8. [Shared services and common rules](#8-shared-services-and-common-rules)
9. [API, data, and configuration reference](#9-api-data-and-configuration-reference)
10. [Testing and known limitations](#10-testing-and-known-limitations)
11. [Troubleshooting](#11-troubleshooting)
12. [Document history](#12-document-history)

---

## 1. What is EWMS?

EWMS (Enterprise Workforce Management System) is a **backend-only** HR management system that manages an organization's workforce across the whole employee lifecycle: hiring (recruitment → offer → onboarding → employee record), day-to-day operations (organization structure, attendance, leave), money (payroll, salary structures, payslips), performance (reviews, goals), physical property (assets), and the approvals and notifications that hold it all together.

It is built with:

| Term | Plain-English meaning | Use in EWMS |
|---|---|---|
| **SAP CAP** | "Cloud Application Programming model" — a framework that generates an OData REST API + database from declarative `.cds` model files | The whole backend framework |
| **Node.js** | JavaScript runtime that runs the CAP server | Server runtime (v22 at verification time) |
| **CDS** | "Core Data Services" — files (`.cds`) that define entities (database tables), types (field shapes), and services | `db/` defines the data, `srv/` defines the APIs |
| **OData V4** | An open REST API standard with querying built in (`$filter`, `$expand`, …) | Every service speaks OData V4 at `/odata/v4/...` |
| **SQLite** | A lightweight file database | Development + (in-memory) testing |
| **SAP HANA** | SAP's enterprise cloud database | Production target (configured, not deployed) |
| **XSUAA / IAS** | SAP BTP identity services | Production authentication (configured, not deployed) |

There is **no UI yet** (no Fiori/UI5 in the repo). The backend is deliberately designed so a frontend can be attached later — see [Fiori expectations](#43-how-a-future-fioriui5-frontend-is-expected-to-interact).

### Project layout

```
ewms/
├── db/                     # Data model + seed data
│   ├── schema.cds          # Compiles ALL domain modules in order
│   ├── common/             # Shared types, enums, AuditLog entity
│   ├── organization/       # Company, BusinessUnit, Department, Location, DepartmentHR
│   ├── project/            # Project, ProjectManager
│   ├── team/               # Team, TeamManager
│   ├── employee/           # Employee + all profile detail entities
│   ├── attendance/         # Attendance, Shifts, Holidays, Overtime, ...
│   ├── leave/              # LeaveType, LeaveRequest, LeaveBalance, ...
│   ├── payroll/            # Salary structure, periods, processes, payslips, ...
│   ├── workflow/           # WorkflowDefinition, Instance, Task, History, Delegation
│   ├── notification/       # Notification (+ AppUsers for identity resolution)
│   ├── recruitment/        # Candidate, Offer, Onboarding entities
│   ├── performance/        # PerformanceReview, PerformanceGoal
│   ├── asset/              # AssetCategory, Asset, AssetAssignment, AssetEvent
│   └── data/               # CSV seed data (employs, leave types, workflow defs, ...)
├── srv/                    # Services (APIs) + handlers + security
│   ├── services.cds        # Registers ALL domain services in one place
│   ├── server.js           # Exports cds.server so tests boot the real app
│   ├── common/             # Shared utils (audit, auth, code generator, guards)
│   ├── <domain>/           # *-service.cds + *-security.cds + *-service.js + handlers/
│   └── middleware/         # Employee-context resolution middleware
├── test/                   # Automated node:test suites + manual .http examples
├── docs/                   # This guide + sprint docs
├── package.json            # Dependencies, mock users, profile configuration
└── db.sqlite               # Development database (auto-created, not committed)
```

### Core design principles (from the actual code)

- **UUID primary keys** everywhere; human-friendly codes (like `EMP000001`) generated separately.
- **CDS Associations** instead of hand-managed foreign keys.
- **Managed entities**: every entity inherits `createdAt / createdBy / modifiedAt / modifiedBy` automatically.
- **Business logic lives in handlers** (`srv/<domain>/handlers/*.js`), declared in `srv/<domain>/<domain>-service.js`.
- **Security lives in `*-security.cds` annotations** (declarative `@restrict`) + handler-level re-checks for rules that annotations cannot express.
- **One shared workflow engine, one notification helper, one audit helper** — modules integrate, never copy.

---

## 2. System architecture

### 2.1 How a request travels

Every business request follows the same path through the CAP runtime:

```mermaid
flowchart TD
    A[Client / test harness] -->|"HTTP + auth"| B[CAP server - Express app]
    B --> C[bootstrap middleware<br/>resolve-employee-context.js]
    C --> D{Authenticated?}
    D -- no --> E[401 Unauthorized]
    D -- yes --> F[OData V4 dispatcher<br/>/odata/v4/&lt;service&gt;]
    F --> G["@restrict annotations<br/>(*-security.cds)"]
    G -- role grant fails --> H[403 Forbidden]
    G -- ok --> I[Service implementation<br/>*service.js: audit hooks, handler wiring]
    I --> J[before handlers<br/>required fields, guards, self-write guard]
    J -- req.error/req.reject --> K[400 / 403 / 404 / 409 error response]
    J -- valid --> L[CAP generic CRUD or bound/unbound action]
    L --> M[after handlers<br/>workflow sync, notifications, asset events]
    L --> N[(Database<br/>SQLite dev / in-memory test / HANA prod)]
    I --> O[AuditLog row<br/>sanitized old/new state]
    M --> P[Workflow engine callbacks<br/>+ notify() inbox row]
    L --> Q[200 / 201 response]
```

Step by step:

1. The client sends an HTTP request with an `Authorization` header (mocked basic-auth locally, JWT in production).
2. The **bootstrap middleware** (`srv/middleware/resolve-employee-context.js`) normalizes the user; if `user.attr.employeeId` is missing (production), it resolves the logged-in identity to an employee via the `AppUsers` table (see [Employee identity resolution](#44-employee-identity-resolution)).
3. CAP's OData middleware matches the URL to a **service** (e.g. `LeaveService`) and **entity/action**.
4. **`@restrict` annotations** in `srv/<domain>/<domain>-security.cds` are evaluated: no role → `403`; role OK but the row-level `where` clause excludes the row → the READ returns `404` (a colleague's record looks non-existent) in most modules.
5. The service implementation (`srv/<domain>/<domain>-service.js`) wires: audit hooks, per-domain handler modules, workflow callbacks, and action registrations.
6. **before handlers** validate input (required fields, duplicates, existence, state transitions, ownership). They end early with `req.error(...)` / `req.reject(...)`.
7. The **generic CREATE/READ/UPDATE/DELETE** (or a bound action) runs against the database.
8. **after handlers** do the reaction work: workflow engine callbacks sync business status, `notify()` writes an inbox row, asset actions append an `AssetEvent`.
9. The **audit helper** records who did what — unless the entity is excluded — with sensitive fields redacted.
10. A normal response is returned; on any error the first meaningful business message wins (CAP aggregates multiple `req.error` calls as "Multiple errors occurred", which is why handlers run guards in priority order and return after the first).

### 2.2 Layers and files (who owns what)

| Layer | Where | Example |
|---|---|---|
| Data model | `db/<domain>/*.cds` | `db/leave/leave-request.cds` defines `LeaveRequest : status : enums.LeaveStatus` |
| Registrations | `srv/services.cds` | Registers all domain services + the AuditLogs projection on EmployeeService |
| Service API | `srv/<domain>/<domain>-service.cds` | `srv/leave/leave-service.cds`: projections + action declarations (`StartWorkflow`) |
| Security annotations | `srv/<domain>/<domain>-security.cds` | `srv/asset/asset-security.cds`: every `@restrict` rule |
| Business logic | `srv/<domain>/handlers/*.js` + per-domain `service.js` | `srv/workflow/handlers/workflow-engine.js` |
| Shared logic | `srv/common/` + `srv/middleware/` | audit, auth, notify, code generator, self-write guard |
| Tests | `test/*.test.js` + `test/setup.js` | real HTTP requests through `cds.test()` against the in-memory DB |

### 2.3 Databases per environment

| Environment | Database | Configured in |
|---|---|---|
| Development (`cds watch`) | SQLite file `db.sqlite`, seeded from `db/data/*.csv` | `cds.requires.db = sqlite` in `package.json` |
| Testing (`CDS_ENV=test`) | **in-memory** SQLite (`url: ":memory:"`) — never touches `db.sqlite` | `cds."[test]".requires.db` in `package.json` |
| Production | SAP HANA (+ XSUAA auth) — configured, never deployed by this repo | `cds."[production]"` in `package.json` |

`db/schema.cds` compiles every domain module in dependency order, so `npx cds compile db --to hana` validates the entire production schema in one command.

---

## 3. Environments and configuration

All application configuration lives in `package.json` under the `cds` key:

```jsonc
"cds": {
  "requires": {
    "outbox": false,          // no asynchronous outbox — audit/notify run in-request
    "db": { "kind": "sqlite" },                    // dev default
    "auth": { "kind": "mocked", "restrict_all_services": true, "users": { /* mock users */ } }
  },
  "[test]":       { /* in-memory sqlite */ },
  "[production]": { /* hana + xsuaa */ }
}
```

Key implications:

- `outbox: false` means notifications and audit rows are written **synchronously inside the request transaction** — a notification failure never breaks the business action because the shared `notify()` helper swallows and logs errors instead of throwing (see [notify()](#83-notifications)).
- `restrict_all_services: true` means every service and every operation **not explicitly granted is denied by default** — the security model is deny-by-default.
- The `[test]` profile is activated automatically by `npm test` via `CDS_ENV=test`. Tests never read or write `db.sqlite`.
- The `[production]` profile switches the database to HANA and auth to XSUAA. This is configuration only — no deployment artifacts (MTA, manifests, credentials) exist in the repo.

---

## 4. Authentication and identity

### 4.1 Authentication strategy

| Environment | Mechanism |
|---|---|
| Development / test | CAP **mocked basic auth**: username with an **empty password** (`Authorization: Basic <username>:`). Mock users and their roles are declared in `package.json` under `cds.requires.auth.users`. |
| Production | XSUAA/OIDC JWT tokens (SAP IAS as identity provider). The `[production]` auth block sets `kind: "xsuaa"`. |

Empty passwords are a **local-development convenience only**. In production this auth block is replaced entirely by XSUAA; SAP IAS owns passwords and MFA. Nothing in the repo stores or validates real credentials.

### 4.2 Roles (the complete list)

Defined centrally in [srv/common/auth/roles.js](../srv/common/auth/roles.js) and mirrored in `package.json` / `xs-security.json`:

| Role | Purpose |
|---|---|
| `SystemAdmin` | Full access, project-wide bypass; **has no Employee row** in seed data |
| `HRAdmin` | HR administration: master data, configuration, sensitive conversions |
| `HRExecutive` | HR day-to-day operations (approvals, verification) |
| `FinanceManager` | Compensation visibility, payroll approval/locking |
| `PayrollExecutive` | Payroll processing |
| `DepartmentManager` | Department/manager view (compensation masked) |
| `ProjectManager` | Project management, project/team create |
| `Employee` | Self-service only |

Role groups live in [srv/common/auth/role-groups.js](../srv/common/auth/role-groups.js):

- `HR` = HRAdmin + HRExecutive
- `PAYROLL` = PayrollExecutive + FinanceManager
- `MANAGEMENT` = DepartmentManager + ProjectManager
- `EMPLOYEE_SELF` = Employee

### 4.3 Mock users (local development & tests only)

From `package.json` (`cds.requires.auth.users`) and cross-checked with seed data (`db/data/ewms.db.employee-Employee.csv`, `db/data/ewms.db.organization-DepartmentHR.csv`):

| Username | Roles | Attribute employeeId | Attribute departmentId | Notes |
|---|---|---|---|---|
| `sysadmin` | SystemAdmin, HRAdmin, FinanceManager | `10000000-…-000000000000` | `11111111-dddd-…` | No matching Employee row (deliberate); tests the "no employee linkage" guard |
| `hrperson` | HRExecutive, HRAdmin | `…0002` | same dept | Jane Smith |
| `mgrproj` | ProjectManager | `…0003` | same dept | David Miller |
| `mgrdept` | DepartmentManager | `…0004` | same dept | Sarah Johnson |
| `finmgr` | FinanceManager | `…0005` | same dept | Michael Brown — seeded **DepartmentHR approver** |
| `payexec` | PayrollExecutive | `…0006` | same dept | Emily Davis |
| `empjohn` | Employee | `…0001` | same dept | John Doe — the "plain employee" negative-test user |

All mock users share `departmentId = 11111111-dddd-1111-dddd-111111111111`.

> **Never** treat these as production credentials: they exist only for local runs and automated tests ([test/setup.js](../test/setup.js) uses them as-is).

### 4.4 Employee identity resolution

`@restrict` row-level `where` clauses in CDS (e.g. `where: 'employee_ID = $user.employeeId'`) read **`req.user.attr`**. Two sources feed it:

1. **Production path**: the Express middleware [srv/middleware/resolve-employee-context.js](../srv/middleware/resolve-employee-context.js) — registered on `cds.on("bootstrap")` — looks up the IAS user id in the `AppUsers` table through [employee-context-cache.js](../srv/common/utils/employee-context-cache.js) (5-minute TTL cache, env-tunable via `EMPLOYEE_CONTEXT_TTL_MS`), then fills `user.attr.employeeId` / `user.attr.departmentId`.
2. **Dev/test path**: the same middleware falls back to the values declared directly on the mocked user in `package.json` (bridged into `user.attr`, since mocked auth puts them on the user object, not under `.attr`).

This matters because several authorization guarantees depend on `employeeId` being present. A user without an employee link (like `sysadmin`) **cannot act on employee-scoped workflow tasks** — the engine returns 403 ("Your user is not linked to an employee...").

### 4.5 Authorization layers

| Layer | Enforced by | Example |
|---|---|---|
| 1 – Service/entity-level role grants | `@restrict` in `*-security.cds` | `{ grant: ['READ'], to: ['HRExecutive','HRAdmin','SystemAdmin'] }` |
| 2 – Row-level filters | `where: '... = $user.employeeId'` clauses in the same file | `Payslips` READ for `Employee` role: `payrollProcess.employee_ID = $user.employeeId` |
| 3 – Handler-level business checks | `srv.before(...)`, `srv.on(action)` | workflow `assertTaskAccess`, self-write guard, idempotency 409s |
| 4 – User context helpers | [authorization.js](../srv/common/auth/authorization.js) (`hasRole`, `hasGroup`, `isSystemAdmin`) | used inside handlers for "HR full, others restricted" patterns |

Helper: [srv/common/auth/role-groups.js](../srv/common/auth/role-groups.js) (referred to by `hasGroup(req, 'HR')` etc.).

**403 vs 404 behavior (grounded in code tests):**

- **403 Forbidden** → role grant failed (`@restrict`), or a handler explicitly rejects (`You may only create records for yourself`, workflow task access).
- **404 Not Found** → role OK, but the row-level `where` filtered the row (an Employee reading a colleague's leave request sees an empty result or a 404 — CAP treats "no visible row" this way on single-key reads). Per-entity behavior is verified in the suites (e.g. `test/regression-s1-11.test.js` for Employee cross-read).

---

## 5. Module-by-module documentation (Sprints 1–14, Sprint 15, Sprint 16)

Header notes used throughout:

- **Status**: one of `Implemented`, `Partially Implemented`, `Planned`, `Unable to Verify`.
- Endpoints are service paths under the base `http://localhost:4004` — full service table with entity counts is in [API reference](#91-registered-odata-services).
- "Handler" is the file inside `srv/<domain>/handlers/` unless stated otherwise.

### 5.1 Sprint 1 – Common foundation

**Status: Implemented**

**Purpose**: shared vocabulary the whole system builds on.

- [db/common/types.cds](../db/common/types.cds): typed primitives (`Name50/100/150`, `Description`, `Email`, `Phone`, `Amount` *(Decimal 15,2)*, `Percentage`, `Hours`, `Currency`, …).
- [db/common/enums.cds](../db/common/enums.cds): every status/value enumeration in the system — `Status`, `Gender`, `MaritalStatus`, `EmploymentType`, `ProjectStatus`, `AttendanceStatus`, `WorkLocation`, `LeaveType`, `LeaveStatus`, `ApprovalDecision`, `HalfDayType`, `PayrollStatus`, `ProcessStatus`, `SalaryComponentType`, `CalculationType`, `PayrollAction`, `AssetStatus`, `AssetCondition`, `AssetAssignmentStatus`, `AssetInspectionOutcome`, `InterviewStatus`, `CurrencyType`, `DocumentType`, `BloodGroup`, `AccountType`, `QualificationType`, `WorkMode`, `HolidayType`, plus the Sprint 10–14 enums (workflow, notification, recruitment, performance).
- [db/common/audit-log.cds](../db/common/audit-log.cds): `AuditLog : managed` with `user`, `employeeId`, `departmentId`, `roles` (JSON), `correlationId`, `action`, `entity`, `oldName`/`newName` (LargeString JSON).
- [db/data/*.csv](../db/data/): seed rows used by dev and test boots.

Automated tests: covered implicitly (every domain test relies on these enums).

---

### 5.2 Sprint 2 – Organization

**Status: Implemented**

**Purpose**: the corporate structure — who exists as an entity (company, business unit, department), where they operate, and which HR person belongs to which department (drives **LevelHR approver resolution**).

**Entities** ([db/organization/*.cds](../db/organization)):

- `Company`, `BusinessUnit`, `Location`, `Department` — master data with codes (`COMP0001`, `BU0001`, `DEP0001`, `LOC0001`-style) generated by handlers in `srv/organization/handlers/`.
- `DepartmentHR` — links a Department to an Employee (`fromDate`/`toDate`, `isActive`). This module is the source of truth the workflow engine uses to find "the department's HR person" (LevelHR step approver type).

**Service**: `OrganizationService` at `/odata/v4/organization`; entities `Companies, BusinessUnits, Locations, Departments, DepartmentHRs`.

**Validation / rules** (from `srv/organization/handlers/*.js`):
- Codes auto-generated per entity type via `generateCode(req, ENTITY, "code", "COMP"/"BU"/"DEP"/"LOC"/…", n)`.
- Duplicate name checks per entity (e.g. department name uniqueness among Active rows).

**Permissions** ([srv/organization/organization-security.cds](../srv/organization/organization-security.cds)):

| Role | Companies / BusinessUnits / Locations / Departments | DepartmentHRs |
|---|---|---|
| Employee, DepartmentManager, ProjectManager, HRExecutive, HRAdmin, FinanceManager, PayrollExecutive, SystemAdmin | READ | — |
| HRAdmin, SystemAdmin | full CRUD | full CRUD |
| HRExecutive | — | READ |
| Any other role | — | no access |

**Row-level restrictions**: none (organization data is shared).

**Dependencies**: Employee (for `DepartmentHR.employee`), Workflow (passively — supplies LevelHR approvers), all other modules (reference org data).

**Notifications/Audit/Workflow uses**: audit rows are registered via `registerAuditHooks` in [organization-service.js](../srv/organization/organization-service.js) for all entities; no workflow or notifications.

**Tests**: `test/regression-s1-11.test.js` (Sprint 2 block).

---

### 5.3 Sprint 3 – Employee core

**Status: Implemented**

**Purpose**: the single Employee master that every other module references. This already includes corporate placement (Designations, Grades, Assignments), alongside personal master data.

**Entities** ([db/employee/*.cds](../db/employee)):

- `Employee` — the master record (see `employee.cds`): code (`EMP000001`), identity fields, addresses, family, emergency contact, employmentType, workMode, status. Compositions: `banks`, `educations`, `experiences`, `documents`, `statutoryDetails`.
- `Designation`, `Grade` — reference master data.
- `EmployeeAssignment` — links Employee ↔ Project/Team/Designation/Grade/reportingManager with `fromDate`/`toDate`/`isActive`. This is what workflow "Manager" steps resolve through (the requester's active assignment's `reportingManager`).
- `EmployeeHistory` — audit-style snapshot store for HR-run reporting (read HR/HRExecutive/SystemAdmin only).

**Service**: `EmployeeService` at `/odata/v4/employee`; entities `Employees, Designations, Grades, EmployeeAssignments, EmployeeHistory, Banks, Educations, Experiences, Documents, StatutoryDetails`.

**Important handler rules** ([src](../srv/employee/employee-service.js)):
- Employee create/delete/update handlers in [employee.js](../srv/employee/handlers/employee.js), [document.js](../srv/employee/handlers/document.js), [bank.js](../srv/employee/handlers/bank.js), [statutory-detail.js](../srv/employee/handlers/statutory-detail.js), [education.js](../srv/employee/handlers/education.js), [experience.js](../srv/employee/handlers/experience.js) — all noted in the Sprint 4/5 update-history util.
- Required-field checks (`firstName`, `lastName`, `email`, `joiningDate`), age validation (via `business-rules.js`), future-joining-date rejection.
- Email format + duplicate-email check for create.
- Assignment linking (project/team/designation/grade/reportingManager).
- **Direct status changes blocked** for sensitive actions like relieving (handled in employee handlers).

**Permissions** ([srv/employee/employee-security.cds](../srv/employee/employee-security.cds)):

| Entity | Employees | DepartmentManager / ProjectManager | HRExecutive / HRAdmin / FinanceManager / SystemAdmin |
|---|---|---|---|
| `Employees` | READ only own row (`ID = $user.employeeId`) | READ for their project's department (`assignments.project.department_ID = $user.departmentId`) | READ all; **HRAdmin + SystemAdmin have full CRUD** (HRExecutive/FinanceManager read-only) |
| `Designations`, `Grades` | READ (everyone authenticated) | READ | full CRUD (HRAdmin + SystemAdmin) |
| `EmployeeAssignments` | no access | READ | READ all; full CRUD (HRAdmin + SystemAdmin) |
| `EmployeeHistory` | no access | no access | READ (HRExecutive, HRAdmin, SystemAdmin) |
| `Banks` | READ/CREATE/UPDATE own (`employee_ID = $user.employeeId`) | — | READ + full CRUD (HRAdmin, HRExecutive, FinanceManager, SystemAdmin) |
| `Educations`, `Experiences` | READ/UPDATE own | — | READ + full CRUD (HRAdmin, HRExecutive, SystemAdmin) |
| `Documents` | READ/CREATE own | — | READ + UPDATE/DELETE (HRAdmin, SystemAdmin) |
| `StatutoryDetails` | READ own | — | READ + full CRUD (HRAdmin, SystemAdmin) |

Row-level scope notes (from the actual `where` clauses):
- DepartmentManager/ProjectManager READ scope for `Employees` is **project-department** scope (`assignments.project.department_ID = $user.departmentId`), not "reports-to-me".
- An `Employee` user simply cannot read a colleague's `Employees` row at all — no access (this is a **403**, not a 404, since they have no READ grant at all on other employees' rows; the test file `test/regression-s1-11.test.js` confirms the 403/404 handling).

**Special projection in [srv/services.cds](../srv/services.cds)**: `AuditLogs` is projected onto `EmployeeService`, gated to `SystemAdmin` only, path `/odata/v4/employee/AuditLogs`.

**Dependencies**: every module (this is the person identity source). Projects/Teams (assignment). Audit (employee context in every audit row).

**Tests**: `test/regression-s1-11.test.js` (Sprint 3 block) + `test/security.http` for manual examples.

---

### 5.4 Sprint 4 – Employee profile details

**Status: Implemented**

**Purpose**: everything around the employee record — bank accounts, education, experience, documents, statutory IDs.

**Entities** ([bank.cds](../db/employee/bank.cds), [education.cds](../db/employee/education.cds), [experience.cds](../db/employee/experience.cds), [document.cds](../db/employee/document.cds), [statutory-detail.cds](../db/employee/statutory-detail.cds)) — all under [db/employee/](../db/employee):

| Entity | Key fields | Notable rules |
|---|---|---|
| `Bank` | employee, bankName, accountNumber, IFSC, accountType | Multiple accounts allowed; duplicate-account detection; physical delete denied in handler (soft status change) |
| `Education` | institution, qualification (QualificationType), passingYear, score | Qualification-aware validation (percent 0–100, CGPA 0–10); passing-year not in the future |
| `Experience` | company, positions, joiningDate/relievingDate | joiningDate < relievingDate; salary not negative |
| `Document` | documentType (DocumentType), fileName, expiryDate | HR-only verification; size-guard on upload |
| `StatutoryDetail` | panNumber, aadhaarNumber, uanNumber, pfNumber, passportNumber | Format checks; one row per employee (`Composition of one`) |

**Service**: `EmployeeService` (same as Sprint 3 — these are projections on the same service).

**Permissions**: see the `Banks/Educations/Experiences/Documents/StatutoryDetails` rows in the Sprint 3 table above.

**Dependencies**: Employee (compositions). Payroll (banks hold the payroll account; statutory details feed tax).

**Tests**: covered indirectly by regression suite; dedicated `.http` examples in `test/employee.http` style are not present — the intersection is the regression suite.

---

### 5.5 Sprint 5 – Attendance

**Status: Implemented**

**Purpose**: time-tracking — shifts, check-in/check-out, holidays, work schedules, overtime.

**Entities** ([db/attendance/*.cds](../db/attendance)): `Attendance`, `Shift`, `ShiftAssignment`, `Holiday`, `HolidayCalendar`, `WorkSchedule`, `Overtime`.

**Service**: `AttendanceService` at `/odata/v4/attendance`; entities `Attendances, Shifts, HolidayCalendars, Holidays, Overtimes, ShiftAssignments, WorkSchedules`.

**Key behaviors** ([attendance.js](../srv/attendance/handlers/attendance.js)):
- `CREATE` — before-handler checks: `employee_ID`, `attendanceDate`, `checkIn` required; duplicate attendance for the same employee+date gets 400; shift resolution goes WorkSchedule-override → ShiftAssignment → no-active-assignment → 400.
- After-handler enriches default `attandenceStatus` (`Present` vs `WorkFromHome` based on `workLocation`), `workedHours` derived from check-in/check-out.
- `UPDATE` — acts as **check-out**: blocks changing `employee_ID`, `attendanceDate`, `shift_ID`, `workLocation`, `workedHours`; the fields`earlyLeavingMinutes`, `lateMinutes` are recalculated from checkOut vs shift.
- `Overtime` must pass a positive-hours check; `Overtimes` READ is self-scoped; UPDATE is DepartmentManager-only (per `attendance-security.cds`).
- `ShiftAssignment` create validates the shift exists and the employee exists; IDs auto-generated where relevant.

**Permissions** ([srv/attendance/attendance-security.cds](../srv/attendance/attendance-security.cds)):

| Entity | Employee | DepartmentManager | HRAdmin, SystemAdmin |
|---|---|---|---|
| `Attendances` | CREATE, READ, **UPDATE own** (`employee_ID = $user.employeeId`) | READ, UPDATE for project-department scope | full CRUD |
| `Overtimes` | CREATE, READ own | READ, UPDATE | full CRUD |
| `Shifts`, `HolidayCalendars`, `Holidays`, `ShiftAssignments`, `WorkSchedules` | READ | READ | CREATE/READ/UPDATE/DELETE |

**Self-write guard** (added later, verified by tests): before the CREATE handler reads `employee_ID`, `assertSelfCreate` (see [self-write-guard.js](../srv/common/utils/self-write-guard.js)) rejects a plain-employee CREATE with a different `employee_ID` with **403**.

**Dependencies**: Employee, Leave (days of `Leave` attendance type show up in attendance enums but are updated by the leave module), Payroll (uses worked hours conceptually).

**Tests**: `test/regression-s1-11.test.js` (Sprint 5 block).

---

### 5.6 Sprint 6 – Leave management

**Status: Implemented**

**Purpose**: time-off requests, balances, and approvals — plus the **only** currently in-place direct-approval flow (LeaveApprovals) alongside the generic workflow (optional per request).

**Entities** ([db/leave/*.cds](../db/leave)):

- `LeaveType` — catalog with codes, `requiresDocument`, `maxDaysPerRequest`, `carryForward`, `isPaid`.
- `LeaveRequest` — the request row: `employee`, `leaveType`, `fromDate/toDate/totalDays`, `halfDay`+`halfDayType`, `emergencyLeave`, `attachment`, `status` (`LeaveStatus`: Draft, Pending, TeamApproved, ProjectApproved, HRApproved, Rejected, Cancelled), `remarks`, `appliedOn`.
- `LeavePolicy` — per company/BU/department/type: carry-forward limit, notice days, etc.
- `LeaveBalance` — per employee/type/year: `allocatedDays`, `usedDays`, `pendingDays`.
- `LeaveApproval` — two-level approval flow (`ApprovalDecision`: Pending / Approved / Rejected).
- `ApprovalHistory` — append-only history of decisions.

**Service**: `LeaveService` at `/odata/v4/leave`; entities `LeaveTypes, LeaveRequests, LeavePolicies, LeaveBalances, LeaveApprovals, ApprovalHistories`.

**Key behaviors**:
- `srv.before("CREATE", LeaveRequests)` in [leave-request.js](../srv/leave/handlers/leave-request.js):
  1. **Self-write guard** (`assertSelfCreate(req, "employee_ID")`) — a plain-employee body with someone else's `employee_ID` gets 403.
  2. Required fields; chronology (`fromDate <= toDate`).
  3. Employee exists; LeaveType exists and is `Active`.
  4. **Overlap guard**: same employee has any non-Cancelled request whose range intersects → 400.
  5. Half-day requests set `totalDays = 0.5`; otherwise inclusive day count.
  6. `leaveNumber` auto-generates `LVnnnnnn`.
- `srv.after("CREATE")` reserves balance via `pendingDays += totalDays` and pre-creates Level-1 `LeaveApproval` rows from the active assignment's reporting manager.
- Before UPDATE guards, structured state-transition rules (only `Cancelled` can be set directly; approval moves go through `LeaveApprovals`), and the freeze on core fields after an operational transition.
- `Cancel` reverses `pendingDays`/`usedDays` based on current status.
- **Workflow engine integration optional per request** — each `LeaveRequest` has a bound `StartWorkflow(summary)` action ([leave-service.cds](../srv/leave/leave-service.cds)), gaurded in [leave-workflow.js](../srv/leave/handlers/leave-workflow.js): only the request owner (or HR/Admin) may start, en 409 if a workflow instance is already open for the object.

**Permissions** ([srv/leave/leave-security.cds](../srv/leave/leave-security.cds)):

| Entity | Employee | DepartmentManager / HRExecutive / HRAdmin / SystemAdmin |
|---|---|---|
| `LeaveRequests` | READ/CREATE/UPDATE/DELETE own (`employee_ID = $user.employeeId`); bound `StartWorkflow` to Employee + managers + HR | DepartmentManager: READ/UPDATE where **department** filter (`employee.assignments.project.department_ID = $user.departmentId`); HRAdmin/SystemAdmin: full CRUD |
| `LeaveApprovals` | READ (via `leaveRequest.employee_ID = $user.employeeId`) | READ/UPDATE (DepartmentManager, HRExecutive); HRAdmin/SystemAdmin full CRUD |
| `LeaveBalances` | READ own | HRAdmin/SystemAdmin full CRUD |
| `LeaveTypes` | READ (all roles) | HRAdmin/SystemAdmin full CRUD |
| `LeavePolicies` | READ (all roles) | HRAdmin/SystemAdmin full CRUD |
| `ApprovalHistories` | NO access | READ: HRAdmin, DepartmentManager, SystemAdmin |

**Dependencies**: Employee, Attendance (types), Workflow (bound StartWorkflow), Notification (no leave-specific notify)

**Tests**: `test/regression-s1-11.test.js` (Sprint 6 block), including the **overlap-guard test** and the **self-create guard test**.

---

### 5.7 Sprint 7 – Payroll

**Status: Implemented** (configuration + period/processing are Sprints 7–8; this section covers the full `PayrollService` steady state)

**Purpose**: salary structures, pay components, employee salaries, monthly payroll processing periods/processes, payslips, and audit history.

**Entities** ([db/payroll/*.cds](../db/payroll)):

- `SalaryComponent`, `SalaryStructure`, `SalaryStructureItem` — configuration: components (Basic, HRA, ...) and grade-linked structures with items that are `Fixed` or `Percentage` of the monthly amount.
- `EmployeeSalary` — which employee is on which structure with what `monthlyCTC`.
- `PayrollPeriod` — month/year period with `workingDays`, `isLocked`.
- `PayrollProcess` — per (period, employee): status `Pending/Processed/Approved/Rejected/Published`.
- `PayrollDetail` — per process: a component line with calculated amounts.
- `Payslip` — per-process payslip; `PublishPayslip` restricted to HRAdmin/SystemAdmin.
- `PayrollHistory` — action-level history (in the schema; not projected for employees).

**Service**: `PayrollService` at `/odata/v4/payroll`; entities `SalaryComponents, SalaryStructures, SalaryStructureItems, EmployeeSalaries, PayrollPeriods (with actions), PayrollProcesses (with actions), PayrollDetails, Payslips (with action), PayrollHistories`.

**Bound actions** ([payroll-service.cds](../srv/payroll/payroll-service.cds)):

| Entity | Action | Restricted to |
|---|---|---|
| `PayrollPeriods` | `ProcessPayroll(otRateMultiplier)` | PayrollExecutive, SystemAdmin |
| | `ApprovePayrollBatch` | FinanceManager, SystemAdmin |
| | `LockPayroll` | FinanceManager, SystemAdmin |
| | `UnlockPayroll` | SystemAdmin |
| `PayrollProcesses` | `RecalculatePayroll` | PayrollExecutive, SystemAdmin |
| | `RejectPayroll(reason)` | FinanceManager, SystemAdmin |
| `Payslips` | `PublishPayslip` | HRAdmin, SystemAdmin |

**Permissions** ([srv/payroll/payroll-security.cds](../srv/payroll/payroll-security.cds)):

| Entity | READ | WRITE / actions |
|---|---|---|
| `PayrollPeriods` | FinanceManager, HRAdmin, SystemAdmin, PayrollExecutive | full CRUD + actions (see table above) — **PayrollExecutive + SystemAdmin only for CRUD** |
| `PayrollProcesses` | PayrollExecutive, FinanceManager, HRAdmin, SystemAdmin | full CRUD: PayrollExecutive, SystemAdmin; actions per table above |
| `EmployeeSalaries` | FinanceManager, HRAdmin, SystemAdmin | full CRUD: HRAdmin, SystemAdmin |
| `Payslips` | **Employee self-scoped** (`payrollProcess.employee_ID = $user.employeeId`), HRAdmin, PayrollExecutive, SystemAdmin | full CRUD: HRAdmin, PayrollExecutive, SystemAdmin; `PublishPayslip` per above |
| `PayrollHistories`, `PayrollDetails` | HRAdmin, FinanceManager, SystemAdmin | — (engine-written) |
| `SalaryComponents`, `SalaryStructures`, `SalaryStructureItems` | HRAdmin, FinanceManager, SystemAdmin | full CRUD: HRAdmin, SystemAdmin |

Row-level: employees can only read their own payslips — reading anything else in this service is denied.

**Dependencies**: Employee (for salary links), Organization (grade/desig linked structures), Attendance (base data the payroll engine reads conceptually — not fused in code).

**Tests**: `test/regression-s1-11.test.js` (Sprint 7 + 8 blocks) and `test/payroll.http` for manual examples. Engine-side processing is exercised in the regression test only up to the lock/unlock lifecycle; per-employee calculation deep-flows sit in `test/payroll.http` as **manual** examples (not automated). Marked as **partially automated**.

**Sensitive-data handling**: EmployeeSalary rows (`monthlyCTC`) and payslips carry salary data; audit entries redact salary/amount fields (see [audit.js](../srv/common/utils/audit.js) SENSITIVE_FIELDS list). One current limitation noted in the audit: the field-level masking for `PayrollDetail.amount` and `SalaryStructureItem.amount` is done only by the audit layer, not by an after-READ filter on those entities; the READ-side access is protected by role grants (`HRAdmin`, `FinanceManager`, `SystemAdmin` only).

---

### 5.8 Sprint 8 – Payroll period lifecycle

**Status: Implemented** (the actions in 5.7 mapped onto real state transitions)

The period/process lifecycle verified end-to-end in the audit:

1. `PayrollPeriod` starts unlocked.
2. `ProcessPayroll` → a `PayrollProcess` per employee with `Pending → Processed` (and payslips/details created).
3. `ApprovePayrollBatch` → FinanceManager review; `RejectPayroll(reason)` loops the batch back.
4. `LockPayroll` → sets `PayrollPeriod.isLocked = true`; only SystemAdmin can `UnlockPayroll`.
5. `PublishPayslip` flips a payslip to published (visible to the employee).

Authorization is enforced at **two layers**: the `@requires: [...]` on the action in the CDS (uppercase HTTP 403) and inside the handler (state transitions locked/unlocked, review-time re-check). The regression test verifies: FINMGR can lock, FINMGR **cannot** unlock (403), SystemAdmin can, and plain employee hits 403 on both actions.

---

### 5.9 Sprint 9 – Security and authorization

**Status: Implemented**

See [Section 4](#4-authentication-and-identity) for the full security documentation (authentication, identity resolution, roles, role groups, user-context helpers, 403/404 semantics). This section covers the remaining pieces.

**Shared authorization utility** [srv/common/auth/authorization.js](../srv/common/auth/authorization.js):

| Function | Purpose |
|---|---|
| `hasRole(req, ...roles)` | true if the user has ANY of the given roles (SystemAdmin bypasses) |
| `hasGroup(req, groupName)` | true for any role in a named group from role-groups.js (SystemAdmin bypasses); throws on unknown group |
| `isSystemAdmin(req)` | direct SystemAdmin check |

Used by the workflow engine (`assertTaskAccess`, `cancelInstance`), the delegation handler, and (indirectly) by the self-write guard's role-bypass pattern.

**Audit logging** [srv/common/utils/audit.js](../srv/common/utils/audit.js):

- `registerAuditHooks(srv, { include: [...] })` — opt-in by entity short name. Registers before-READ-(old-state)-capture for UPDATE/DELETE plus after-CREATE/UPDATE/DELETE audit writes via `persistAudit`.
- `persistAudit(req, action, entityName, oldVal, newVal)` — inserts one `AuditLog` row with user/employee/dept/roles/correlationId from the request; **swallows errors** (`LOG.error`) so an audit write failure never breaks a business action.
- `SENSITIVE_FIELDS` list — redacts (`***REDACTED***`) passwords, tokens, pan/aadhaar/passport, bank/IFSC, salary/amount/percentage/rate, etc. in both old and new payloads (case-insensitive `***REDACTED***` substitution).
- `deepMerge` — PATCHes write the merged full state, not just the delta.
- `extractKeys(req)` — raw-UUID-safe key extraction (wraps raw param scalars into `{ <keyElement>: value }`).
- `attachAuditLogReadFormatter` — binds `oldName`/`newName` JSON strings into nested objects on read (used by `EmployeeService` for `AuditLogs`).

**Self-write guard** [srv/common/utils/self-write-guard.js](../srv/common/utils/self-write-guard.js):

- `assertSelfCreate(req, field)` / `assertSelfWrite(req, field)` — reject with 403 any non-admin create/update that targets another user's `employee_ID`. Bypass list: `HR`, `PAYROLL`, `MANAGEMENT` (role-group names), i.e. HR / PayrollFinance / managers, plus SystemAdmin via `hasRole`/group bypass.
- **Why it exists**: CAP's row-level `@restrict` where-clauses filter **READs** reliably but cannot filter a **CREATE** (the row does not exist yet). Without this guard a plain employee could POST a leave request or attendance row for a colleague. Exposed and tested in the regression suite.

**Row-level scope recap (verified in code+tests)**:

| Data type | Who sees what |
|---|---|
| Employee master | self (READ); dept-employee via project assignment (managers); all (HR/Finance) |
| Attendance, Leave requests, Balances, Banks, Documents, Statutory, Educations, Experiences, Payslips | self, or full/none per role table above |
| Performance reviews/goals | employee = self; reviewer = their assigned; goal assignee = their goals; HR everything; others none |
| Assets/assignments/events | holder = their assets + own assignments; assigner = their assignments; admins everything; plain Employee no events READ |
| Offers | managers only where `reportingManager_ID = $user.employeeId`, CTC masked |
| Onboarding tasks | assignee sees own; HR manages all |

**Tests**: `test/regression-s1-11.test.js` + negative tests embedded in all four suites.

---

### 5.10 Sprint 10 – Generic workflow engine

**Status: Implemented**

**Purpose**: one reusable approval engine that any module plugs into via `registerCallbacks`. Leave (bound action), Offers (auto-started), and Performance reviews (auto-started) all use it; Assets deliberately do not (documented extension point).

**Model** ([db/workflow/*.cds](../db/workflow)):

- `WorkflowDefinition` (definitionCode like `WF-LEAVE-STD`, businessObjectType such as `ewms.db.leave.LeaveRequest`, approvalType = default step mode, `allowSelfApproval` flag, status). **Only `Active` definitions can start new instances** (running instances finish normally even if the definition is later deactivated).
- `WorkflowStep` (stepNumber, name, approverType `Position | Role | Manager | LevelHR`, slaDays, approvalMode `SingleSequential | AllMustApprove | AnyCanApprove`, `skipIfSameAsRequester` filtering, `mandatoryStep`).
- `WorkflowInstance` (businessObjectType/Id, definition, requester, status `Running/Approved/Rejected/Cancelled/Terminated/Rework`, `currentStep` FK).
- `WorkflowTask` (instance, step snapshot incl. `assigneeType/Employee/Role`, status `Open/Approved/Rejected/Skipped/Cancelled`, decision fields incl. `decidedVia` = `Direct | Delegation`, dueDate from sla).
- `WorkflowHistory` — append-only; **UPDATE and DELETE both rejected with 400**.
- `WorkflowDelegation` — date-ranged, scoped delegation (`global` / per definition / per task).

**Service**: WorkflowService at `/odata/v4/workflow`. Entity actions:

| Entity | Action | Effect summary |
|---|---|---|
| WorkflowTasks | `Approve(comments)` | single step: closes the task, opens next or completes; parallel modes: waits for siblings or first-wins |
| WorkflowTasks | `Reject(comments)` (mandatory comments) | closes task, finalizes instance `Rejected`, notifies module |
| WorkflowTasks | `SendBack(comments)` (mandatory) | closes task + skips siblings, puts instance `Rework`, calls module `applyRework` |
| WorkflowTasks | `Reassign(newAssignee_ID, comments)` | permanently moves the task; blocked to the requester (self-approval guard) |
| WorkflowTasks | `Delegate(delegate_ID, comments)` | lets delegate act for assignee; assignee preserved; decidedVia = `Delegation` |
| WorkflowTasks | `EscalateTask(comments)` | HR-only; hands task to the department HR rep |
| WorkflowInstances | `CancelWorkflow(comments)` | requester or HR/SystemAdmin; only `Running`/`Rework`; closes open tasks |
| WorkflowInstances | `ResubmitWorkflow()` | requester-only, only from `Rework`; reopens step 1 on the SAME instance |
| — (unbound) | `StartWorkflow(businessObjectType, businessObjectId, summary)` | HR-only back-office path; modules expose their own bound version |

**Engine rules (in [workflow-engine.js](../srv/workflow/handlers/workflow-engine.js))** — all verified in code / tests:

R1 definition must be `Active`; R2 finalized workflows cannot be decided again; R3 rejected task path only via the SendBack→Rework→Resubmit cycle; R4 task access requires assignee-or-authorized-delegee-or-SystemAdmin (`assertTaskAccess`); R5 Reject+SendBack need comments; R6 every transition writes one immutable `WorkflowHistory` row; R7 the requester can never approve their own instance unless the definition's `allowSelfApproval` is on.

**Integrity guards** (also in the engine):
- `WorkflowHistories` — UPDATE/DELETE → 400 (append-only).
- Instances/tasks — direct CREATE → 400 ("created only via StartWorkflow / by the engine"); instance status / task decision fields cannot be PATCHed directly.
- Instances cannot be DELETEd — cancel instead. Direct task DELETE likewise denied.

**Callbacks & synchronizations** [business-callbacks.js](../srv/workflow/handlers/business-callbacks.js):

| Module | Type key | Callbacks registered |
|---|---|---|
| Leave | `ewms.db.leave.LeaveRequest` | `applyDecision` (Approved / Rejected syncs leave status), `applyRework` (reverts status), `applyResubmit` |
| Offer | `ewms.db.recruitment.Offer` | `applyDecision`, applyRework, applyResubmit (offer status sync from workflow task decision) |
| PerformanceReview | `ewms.db.performance.PerformanceReview` | `applyDecision` (Approved → Approved, Rejected → Draft sync), applyRework, applyResubmit |

**Step resolution** [step-resolvers.js](../srv/workflow/handlers/step-resolvers.js): `resolveStepApprovers(tx, step, instance)` returns the approver rows for a step, even for Manager-queue steps (`Position` → specific person; `Role` → first active user with the role; `Manager` → requester's active assignment's reportingManager; `LevelHR` → active DepartmentHR of the requester's department). Applies "skip if same as requester" filtering before task creation.

**Permissions** ([output from workflow-security.cds](../srv/workflow/workflow-security.cds)):

| Entity/Action | Who |
|---|---|
| `WorkflowDefinitions`, `WorkflowSteps` | READ almost everyone; CREATE/UPDATE/DELETE = HRAdmin + SystemAdmin |
| `WorkflowInstances` | READ almost everyone; actions `CancelWorkflow`/`ResubmitWorkflow` = everyone (engine re-checks) |
| `WorkflowTasks` | READ managers/HR/HRAdmin/others **includes plain Employee** — but row visibility is filtered by `assertTaskAccess` in the engine for non-assignees (with the nuances of candidates/delegations); Approve/Reject/SendBack/Delegate = Employee+ all role users (engine re-checks access); Reassign = managers/HR only; `EscalateTask` = HRExecutive/HRAdmin/SystemAdmin |
| `WorkflowHistories` | READ managers/HR/PayrollPeople/SystemAdmin; **no WRITE for anyone**; direct UPDATE/DELETE → 400 |
| `WorkflowDelegations` | everyone CRUD their **own** (`delegator_ID = $user.employeeId`); HRAdmin/SystemAdmin full |
| unbound `StartWorkflow` | HRAdmin + SystemAdmin only |

**Notifications**: engine state transitions call module callbacks; **notification sending is the module's responsibility** (Offer/Performance handlers notify; the engine itself writes history but does not create notification rows). Verified per-module below.

**Tests**: `test/regression-s1-11.test.js` (definitions/steps/StartWorkflow/history + guards), `test/recruitment.test.js` (workflow approval for offers), `test/performance.test.js` (workflow approval for reviews), `test/asset.test.js` (documents the wired-but-unused extension point).

---

### 5.11 Sprint 11 – Notifications

**Status: Implemented** (IN_APP channel only; the EMAIL channel exists in the enum — future-proofing, no sender)

**Purpose**: every user has ONE private inbox; business modules enqueue messages through the shared `notify()` helper.

**Notifications module** ([db/notification/notification.cds](../db/notification/notification.cds), [service](../srv/notification/notification-service.cds), [core](../srv/notification/handlers/notification-core.js), [security](../srv/notification/notification-security.cds)):

- `Notification` entity with `recipient_ID`, `title`, `message`, `category`, `priority`, `status` (`Unread/Read`), `sourceModule`, `sourceEntity`, `sourceRecordId`, `actionLink`, `channel` (IN_APP/EMAIL).
- `CreateNotification` is registered as an **unbound action restricted to SystemAdmin** (a test/tool back-door). Business modules use `notify()`.
- `notify(txOrService, { recipientId, title, message, category, priority, ... })` — builds one `Notification` row inside the **current transaction**; never throws; returns the ID or `null`. Truncates long strings to column limits.
- `MarkAsRead` is a **bound action on one's own rows**, idempotent — re-reading an already-read row is a no-op that still returns success. Handler-level check in [notification-service.js](../srv/notification/notification-service.js) re-verifies ownership ("You can only manage your own notifications", 403).
- Notifications never go back to `Unread` (documented decision in `notification-security.cds`).

**Permissions**:

| Entity/Action | Who |
|---|---|
| `Notifications` READ | every role, **only their own rows** (`recipient_ID = $user.employeeId`) |
| `MarkAsRead` | every role (own rows; handler re-checks) |
| `CreateNotification` | SystemAdmin only |
| Direct UPDATE/DELETE | no one (retained) |

**Notification categories** (from `enums.NotificationCategory`): `WORKFLOW, LEAVE, PAYROLL, DOCUMENT, RECRUITMENT, PERFORMANCE, ASSET, TIMESHEET, ATTENDANCE, COMPLIANCE, SYSTEM`. Used today by recruitment, performance, and asset handlers (RECRUITMENT, PERFORMANCE, ASSET categories); the rest are reserved vocabulary.

**Dependencies**: Employee (recipient FK), all sender modules.

**Tests**: `test/regression-s1-11.test.js` (privacy per recipient, idempotent MarkAsRead, cross-user MarkAsRead 403, CreateNotification 403 for non-admin).

---

### 5.12 Sprint 12 – Recruitment and onboarding

**Status: Implemented**

**Purpose**: hire someone — candidate → offer (with generic-workflow approval) → candidate accepts → onboarding case + checklist → tasks/documents → **ConvertToEmployee** (idempotent) into the existing Employee Core.

**Entities** ([db/recruitment/recruitment.cds](../db/recruitment/recruitment.cds)):

- `Candidate` — a person, **not** an employee (`CandidateStatus`: New → Selected → (offer flow) → Hired on conversion; Withdrawn/Rejected side exits) with `candidateCode`.
- `Offer` — per candidate; lifecycle status `OfferStatus` (Draft, PendingApproval, Approved, Sent, Accepted, Rejected, Expired, Withdrawn) with `offerNumber`, compensation (`offeredCTC`, sensitive), joining/expiry dates, workLocation.
- `OnboardingChecklist` + `OnboardingChecklistItem` — reusable task templates (sequence, `taskCode` like `VERIFY_IDENTITY`, mandatory flag).
- `OnboardingCase` — created **automatically** on `RecordAcceptance` (or manually by HR); carries target org data, `progress` %, and the **idempotency marker** `convertedEmployee` (Association — FK column `convertedEmployee_ID`).
- `OnboardingTask` — one row per task per case (Pending/InProgress/Completed/Skipped/Blocked), assignee employee or role.
- `OnboardingDocumentRequirement` — per doc type (IDENTITY, ADDRESS, EDUCATION, EXPERIENCE, SIGNED_OFFER, TAX); status Required → Submitted → Verified/Rejected/Waived.

**Service**: `RecruitmentService` at `/odata/v4/recruitment`; entities `Candidates, Offers (+9 actions), OnboardingChecklists, OnboardingChecklistItems, OnboardingCases (+6 actions), OnboardingTasks (+5 actions), OnboardingDocumentRequirements (+4 actions)`.

**Bound actions** (declared in [recruitment-service.cds](../srv/recruitment/recruitment-service.cds), behavior in [offer-lifecycle.js](../srv/recruitment/handlers/offer-lifecycle.js), [onboarding-lifecycle.js](../srv/recruitment/handlers/onboarding-lifecycle.js), [employee-conversion.js](../srv/recruitment/handlers/employee-conversion.js)):

| Entity | Action | Rules (from the actual handlers) |
|---|---|---|
| Offers | `SubmitForApproval` | Draft → PendingApproval; auto-starts the generic workflow when an active definition (`WF-OFFER-STD`) exists — requester is the **HR user with an employee link** |
| | `ApproveOffer(comments)` / `RejectOffer(comments)` | direct-approval fallback; blocked (409) while a workflow instance is running |
| | `SendOffer` | Approved → Sent (only), sets `sentOn` |
| | `RecordAcceptance` | Sent → Accepted; locks the offer; auto-creates the OnboardingCase and copies checklist tasks |
| | `RecordRejection(comments)` | Sent → Rejected; candidate never accepted |
| | `WithdrawOffer(comments)` | HR drops a not-yet-accepted offer |
| | `ExpireOffer` | Admin/housekeeping; an expired offer can never be accepted |
| OnboardingCases | `StartOnboarding` / `HoldOnboarding(comments)` / `ResumeOnboarding` / `CompleteOnboarding` / `CancelOnboarding(comments)` / `ConvertToEmployee` | case lifecycle; completion **blocked while mandatory tasks/documents are open**; conversion blocked before Completed (started); **idempotent** — calling it twice never creates a second employee, the case just links the existing one |
| OnboardingTasks | `StartTask / CompleteTask(comments) / SkipTask(comments) / BlockTask(comments) / ReopenTask` | task state machine — mandatory tasks cannot be Skipped, and completion of everything is enforced at case level |
| OnboardingDocumentRequirements | `SubmitDocument(notes) / VerifyDocument(notes) / RejectDocument(notes) / WaiveDocument(notes)` | collection tracking only — real document management is Sprint 17 territory (planned) |

**Special handling**:
- **CTC masking** — after-READ on `Offers` masks `offeredCTC` for DepartmentManager (everything else sees it). Verified in tests.
- **Idempotent conversion** — `ConvertToEmployee` (a) requires the case `Completed`, (b) creates the employee through the standard `Employee` entity + an active `EmployeeAssignment` with the offer-to-case data (department, designation, reporting manager, joining date), (c) reuses existing employee on repeat (returns "linked/already exists" style summary) and never creates a duplicate.
- **Employees are in the Employee Core**, not duplicated here — the OnboardingCase links them via `convertedEmployee` (association; FK `convertedEmployee_ID`).

**Permissions** ([srv/recruitment/recruitment-security.cds](../srv/recruitment/recruitment-security.cds)) — sensitive data, deny-by-default:

| Entity | HRExecutive/HRAdmin/SystemAdmin | DepartmentManager | Plain Employee |
|---|---|---|---|
| `Candidates` | full CRUD | no access | no access |
| `Offers` | READ + full CRUD + lifecycle actions | READ where `reportingManager_ID = $user.employeeId` (CTC masked in code) | no access |
| `OnboardingCases` | READ + full CRUD + lifecycle | READ where they are reporting manager | no access |
| `OnboardingTasks` | READ + full CRUD + task actions | — | READ + Start/Complete **own** (where `assignee_ID = $user.employeeId`) |
| `OnboardingDocumentRequirements` | READ + full CRUD + doc actions | — | no |
| `OnboardingChecklists` / Items | READ (HR incl. HRExecutive); full CRUD HRAdmin + SystemAdmin | — | — |

Action-level grants (verify in the CDS rather than assuming from names):
- `ConvertToEmployee` — **HRAdmin + SystemAdmin only** (creating employees is sensitive).
- `ApproveOffer` / `RejectOffer` (direct fallback) — HRAdmin + SystemAdmin.
- All other lifecycle actions — HR trio (HREx/HRAdmin/SysAdmin).

**Notifications/Audit/Workflow**: offer submission and status changes notify via `notify()` (category `RECRUITMENT`), all mutations audit-logged via `registerAuditHooks`, approval via generic workflow `WF-OFFER-STD`.

**Dependencies**: Workflow (approval), Employee (reporting manager + created employees), Code generator (candidate/offer/onboarding codes), Notification, Audit (handled by shared helpers).

**Tests**: `test/recruitment.test.js` (**31 tests** — the full cross-module flow A–D blocks incl. idempotency, CTC masking, and security).

---

### 5.13 Sprint 13 – Performance management

**Status: Implemented**

**Purpose**: reviews and goals — sensitive evaluation data with strict row-level visibility, reusing the generic workflow for approvals.

**Entities** ([db/performance/performance.cds](../db/performance/performance.cds)):

- `PerformanceReview` — reviewCode, employee (reviewed), reviewer, reviewType (`Annual/HalfYearly/Quarterly/Probation/Project`), period start/end, activity start/dueDate, status (`Draft → PendingReview → InReview → Submitted → Approved → Completed`, Cancelled side exit), `overallRating` (from `PerformanceRating` enum), three comments fields, `submittedAt/completedAt`.
- `PerformanceGoal` — goalCode, employee (goal owner), assignedBy (assigner), optional `review` link, title/description/category/weight (validated 0<weight≤100)/target/measurementCriteria/dueDate (validated not in the past on create), status `Draft → Active → Completed`, achievement + rating + completedAt when done.
- `PerformanceRating` enum: `Unsatisfactory(1), NeedsImprovement(2), MeetsExpectations(3), ExceedsExpectations(4), Outstanding(5)` — CDS validates enum on write, invalid ratings rejected by the framework itself.

**Service**: `PerformanceService` at `/odata/v4/performance`; entities `Reviews (+7 actions), Goals (+3 actions)`.

**Bound actions** ([review-lifecycle.js](../srv/performance/handlers/review-lifecycle.js), [goal-lifecycle.js](../srv/performance/handlers/goal-lifecycle.js)):

| Entity | Action | Rules |
|---|---|---|
| Reviews | `SubmitReview` | Draft → PendingReview; auto-starts `WF-REVIEW-STD`; blocks duplicate open review (same employee+type+overlapping period → **409**) and self-review (`employee == reviewer` → **400**) |
| | `StartReview` | PendingReview → InReview; **the assigned reviewer only** (or HR) |
| | `SubmitEvaluation(overallRating, comments)` | InReview → Submitted; rating must be a valid `PerformanceRating` value (else 400) |
| | `AddEmployeeComments(comments)` | employee on **own** review; never on frozen ones |
| | `ApproveReview(comments)` | Submitted → Approved; **HR fallback only**, blocked 409 while a workflow instance is running |
| | `CompleteReview(finalComments)` | Approved → Completed; **freezes** the review (it cannot be edited after) |
| | `CancelReview(comments)` | any non-final → Cancelled (HR only) |
| Goals | `ActivateGoal` | Draft → Active |
| | `CompleteGoal(achievement, rating)` | Active → Completed; rating validated |
| | `CancelGoal(comments)` | Draft/Active → Cancelled |

**Direct-PATCH protection**: reviews/goals block status mutation through plain PATCH (frozen statuses are immutable; lifecycle changes must go through actions).

**Permissions** ([srv/performance/performance-security.cds](../srv/performance/performance-security.cds)) — row-level by design:

| Role | Reviews | Goals |
|---|---|---|
| HRExecutive / HRAdmin / SystemAdmin | READ all; full CRUD; lifecycle actions (incl. Approve/Complete/Cancel) | READ all; full CRUD; lifecycle actions |
| DepartmentManager / ProjectManager / Employee | READ where `reviewer_ID = $user.employeeId` **OR** `employee_ID = $user.employeeId`; StartReview + SubmitEvaluation on own-reviews (as reviewer); AddEmployeeComments on own-reviewed-as-employee rows | READ where `employee_ID = $user.employeeId` OR `assignedBy_ID = $user.employeeId`; lifecycle actions where they are the assigner |
| PayrollExecutive, FinanceManager | no access | no access |

**Notifications/Audit/Workflow**: review and goal transitions notify via `notify()` (category `PERFORMANCE`); each lifecycle writes audit rows; approval through the generic workflow (WF-REVIEW-STD, module callback sync; LevelHR approver = `finmgr`).

**Dependencies**: Workflow (approval), Employee (reviewer/owner), Organization (DepartmentHR for LevelHR resolution), Code generator (REV/GOAL codes), Notification, Audit.

**Tests**: `test/performance.test.js` (**42 tests**) — includes duplicate review 409, self-review 400, frozen immutability, rating validation, workflow-backed approval, row-level 404s, and direct-PATCH blocks.

---

### 5.14 Sprint 14 – Asset management

**Status: Implemented**

**Purpose**: physical assets — categories, assets, custody (assignments), events, and a fully controlled lifecycle. No approval workflow; deliberately direct actions (documented extension point).

**Entities** ([db/asset/asset.cds](../db/asset/asset.cds)):

- `AssetCategory` — code (CAT0001-style), name, `isActive` (data, not hard-coded logic).
- `Asset` — code/tag (`AST0001` auto), name, category, serialNumber (nullable), model/manufacturer, purchase cost/date/currency/warranty, **status** (`AssetStatus`: Available, Assigned, `Returned` *(legacy value, kept for compatibility — never set by handlers)*, InRepair, Lost, Damaged, Retired, Disposed), **condition** (`AssetCondition`: New, Good, Fair, Damaged, Critical), `location`, `currentHolder` (handler-maintained mirror, never written directly), notes.
- `AssetAssignment` — **one row per custody period** (never deleted — closed rows are the history): asset, employee (holder), assignedBy, dates, status `Active | Returned | Cancelled`, condition-at-assignment/return, `acknowledged`/`acknowledgedOn`, notes. **Exactly ONE Active assignment per asset** at any time (enforced in the handler, retry-safe).
- `AssetEvent` — **append-only** per-event-type stream: `CREATED, ASSIGNED, TRANSFERRED, RETURNED, INSPECTED, REPAIR_STARTED, REPAIR_COMPLETED, MARKED_LOST, MARKED_DAMAGED, RETIRED, DISPOSED` with fromStatus/toStatus/condition/actor/details.

**Service**: `AssetService` at `/odata/v4/asset`; entities `AssetCategories, Assets (+10 actions), AssetAssignments (+AcknowledgeAssignment), AssetEvents (read-only)`.

**Bound actions** ([asset-lifecycle.js](../srv/asset/handlers/asset-lifecycle.js), [asset-master.js](../srv/asset/handlers/asset-master.js)):

| Action | Transition / rule |
|---|---|
| `assignAsset(employee_ID, expectedReturnDate, conditionAtAssignment, notes)` | Available → Assigned; idempotency 409 first ("already has an active assignment"); employee must exist; conditions required for Damaged/Critical assignment |
| `returnAsset(condition, notes)` | Assigned → Available (or → **InRepair** when condition is Damaged/Critical); closes the Active assignment (409 when none) |
| `transferAsset(newEmployee_ID, condition, notes)` | closes old assignment, opens a new one instantly (row order not guaranteed — tests verify by employee_ID) |
| `inspectAsset(condition, outcome, notes)` | blocked while Assigned (409); same condition re-inspection allowed; outcome drives status: `Reusable` → Available, `RepairRequired` → InRepair, `RetireRecommended`/`DisposeRecommended` route to the dedicated actions |
| `startRepair(vendor, notes)` | Available/Damaged → InRepair |
| `completeRepair(condition, repairCost, vendor, notes)` | InRepair → Available; cost validated non-negative |
| `markLost(reason)` | Assigned/Available → Lost; **reason required**; **the Active assignment stays open** (accountability) and the holder is notified |
| `markDamaged(condition, reason)` | Assigned/Available → Damaged |
| `retireAsset(reason)` | blocked while Assigned; end of life (Retired) |
| `disposeAsset(reason)` | blocked while Assigned; Disposed is **immutable** — no further lifecycle actions |
| `AcknowledgeAssignment` (on AssetAssignments) | the receiving employee confirms custody; own rows only; idempotent |

**Direct-PATCH protection**: `status`, `condition`, `currentHolder_ID` on Assets are NEVER writable through plain PATCH — the lifecycle actions own those fields. Direct status mutation → 400.

**Serial-number uniqueness**: explicitly checked in the handler (create/update) — CAP does not enforce `@assert.unique` on the SQLite runtime, so the handler fills that gap (tested).

**Notifications/Audit/Events**: assign/transfer/return/lost send notifications to the right person (new holder / assigner / holder) via `notify()` (category `ASSET`); each action writes audit rows through the shared helper **and** an `AssetEvent` row.

**Permissions** ([srv/asset/asset-security.cds](../srv/asset/asset-security.cds)):

| Entity | HRExecutive/HRAdmin/SystemAdmin | DepartmentManager/ProjectManager | Employee |
|---|---|---|---|
| `AssetCategories` | READ all + full CRUD (HRAdmin + SystemAdmin) | READ | READ |
| `Assets` | READ all + full CRUD + **all lifecycle actions** | READ where `currentHolder_ID = $user.employeeId` | READ where `currentHolder_ID = $user.employeeId` |
| `AssetAssignments` | READ all + `AcknowledgeAssignment` | READ where `assignedBy_ID = $user.employeeId` (their own assignments made) + `AcknowledgeAssignment` own rows | READ where `employee_ID = $user.employeeId` + `AcknowledgeAssignment` own rows |
| `AssetEvents` | READ only | no access | no access |

**Dependencies**: Employee (holder, assigner, actor), Notification, Audit; Code generator (AST/CAT codes). Sprint 21 Exit Management reuses this data (the computed `DepartingEmployeeAssets` view reads exactly this ledger).

**Tests**: `test/asset.test.js` (**44 tests**) — full lifecycle, 409 idempotency, blocked PATCHes, immutable Disposed, serial uniqueness via handler, row-level security, acknowledgment idempotency, and repeat/transfer behavior.

---

### 5.15 Sprint 15 – Timesheet, Shift & Roster Integration

**Status: Implemented** (full detail in [docs/sprints/SPRINT-15.md](sprints/SPRINT-15.md); audit evidence in [docs/sprints/SPRINT-15-AUDIT.md](sprints/SPRINT-15-AUDIT.md)).

**Purpose**: one per-employee timesheet per reporting period (`Draft → Submitted → InReview → Approved`, with reject-to-Draft, withdraw, HR-only reopen, cancel), work items per date validated against the Sprint 4 `EmployeeAssignment`, overnight hours, and **single-consumption by the Payroll engine** (approved sheets are consumed by `ProcessPayroll` exactly once and then frozen).

- Model: [db/timesheet/timesheet.cds](../db/timesheet/timesheet.cds) — `Timesheet` header, `TimesheetItem` (one per work date, computed regular/overtime hours on the shared 8h standard), append-only `TimesheetHistory` ledger.
- Service: `TimesheetService` at `/odata/v4/timesheet` — 8 bound lifecycle actions ([timesheet-service.cds](../srv/timesheet/timesheet-service.cds)); approval optionally rides the Sprint 10 workflow engine (`WF-TIMESHEET-STD` seed).
- Security: reuses Sprint 9 roles with row-level manager scope (`assignedManager_ID`) — [timesheet-security.cds](../srv/timesheet/timesheet-security.cds).
- Tests: [test/timesheet.test.js](../test/timesheet.test.js), 13 tests (lifecycle, manager scope, PATCH-bypass, payroll double-count prevention, concurrency race, notifications).

**Audit gate (verified in Sprint 16's pre-check)**: all 12 Sprint 15 requirements PASS — see [SPRINT-15-AUDIT.md](sprints/SPRINT-15-AUDIT.md) for the classification table. Remaining accepted limitations (overtime standard constant, no rounding policy, post-consumption corrections await a payroll-adjustment mechanism, HANA runtime untested) are listed there and in SPRINT-15.md §7.

---

### 5.16 Sprint 16 – Geo Tracking & Geo-Fencing

**Status: Implemented** (full detail in [docs/sprints/SPRINT-16.md](sprints/SPRINT-16.md)).

**Purpose**: minimal backend location model + reusable geofence validation wired into the **existing** Attendance module. Backend-only; no continuous tracking.

- Model: [db/geo/geo.cds](../db/geo/geo.cds):
  - `Geofence` — company configuration: center coordinates (`@assert.range` lat −90..90 / lng −180..180), radius (10–100000 m), `Active/Inactive` status, effective dates. Auto `GF000n` codes. Deletion blocked; use Deactivate.
  - `EmployeeLocationEligibility` — optional per-employee fence restriction (rows RESTRICT, never widen; no rows = default permissive policy).
  - `AttendanceLocationEvent` — one evidence row per supported check-in/check-out **only when the employee submitted coordinates**: server-computed result `Passed|Bypassed`, coordinates rounded to ~11 m, matched fence + distance.
  - `GeofenceHistory` — append-only configuration ledger (`Created/Updated/Activated/Deactivated`).
- Reusable validator: [srv/geo/geofence-validator.js](../srv/geo/geofence-validator.js) — coordinate/staleness input hygiene (15-minute window), remote-work exception (`WorkFromHome` bypasses), active+effective fence selection, eligibility filtering, haversine distance, deterministic boundary rule. Failed evaluations reject the attendance request with 400 and roll the transaction back.
- Attendance wiring: the Attendance CREATE/UPDATE handlers accept input-only geo fields (`latitude`, `longitude`, `locationTimestamp`, all `@cds.persistence.skip` so coordinates can never appear in attendance reads); a rejected location rejects the whole attendance operation.
- Security ([geo-security.cds](../srv/geo/geo-security.cds)): fences readable by all authenticated, writable by HRAdmin/SystemAdmin only; evidence rows readable by owner + HR trio only; **no write grant on evidence or history rows for any role** (results are server-computed — a client cannot claim a passing geofence result).
- Privacy: no background/push tracking, no full-precision coordinates stored, managers deliberately have no evidence-read grant, no anti-spoofing is claimed (client coordinates are inherently spoofable — documented).
- Tests: [test/geo.test.js](../test/geo.test.js), 18 tests (config validation, distance/boundary, inactive AND future-effective/expired fences, eligibility paths, WFH bypass, staleness, malformed input, check-in/out integration, duplicates/retries, cross-employee denial, audit).

**Accepted limitations**: spoofable client coordinates (attestation out of scope), retention purge job deferred until an HR/legal retention decision, optional 15-minute staleness window is a constant, HANA production profile untested at runtime.

---

### 5.17 Sprint 17 – Documents & Compliance (IMPLEMENTED)

Documents & Compliance is implemented **in place**: the existing
`ewms.db.employee.Document` entity was extended (status, verification,
storage metadata, issue/expiry dates) and a new `compliance` service adds
configurable requirements plus **computed** employee compliance views. No
duplicate documententities exist; recruitment/onboarding keep only their collection trackers.

Core rules (details and tests in [docs/sprints/SPRINT-17.md](./sprints/SPRINT-17.md)):

- **Upload**: metadata + optional real file bytes. Content type is SNIFFED
  from magic bytes (client MIME/filenames are never trusted), hard 10 MB
  limit, sanitized traversal-free filenames, one Active document per
  employee + type (replacement = archive first). Bytes live OUTSIDE the DB
  behind a storage adapter (`srv/compliance/document-storage.js`; keys are
  content-addressed hex — traversal structurally impossible — under the
  private `document-store/` dir, git-ignored); the DB
  stores only a storage key + sha256. `filePath` is masked to `null` on all
  reads; bytes are only served by the bound `Download` action.
- **Verification**: HRAdmin/SystemAdmin-only `Verify` / `Reject`
  (reason mandatory, 409 on double-verify/reject-after-verify) actions;
  direct DELETE and verification-bypass PATCHes are refused. Employees may
  correct their OWN metadata; sensitive fields are handler-locked.
- **Access**: employees scope to their own rows; department/project managers
  deliberately get NO document access; HRAdmin/SystemAdmin full CRUD.
- **Compliance**: `DocumentRequirement` rows (admin-only CRUD, config per
  employment type + effective dates + expiry alert window + optional
  issue-date requirement). `ComplianceSummaries` / `ComplianceLines` are
  `@cds.persistence.skip` computed views (status recomputed per read — never
  stale): Missing / Pending / Rejected / Expired / Expiring / Compliant;
  summary Overdue / Incomplete / Compliant on mandatory lines only.
  **Presence of a document is never compliance** — verification status is
  required, some requirements demand issue dates.
- **Reminders**: `NotifyDocumentExpiries(daysBefore)` — manual, cron-ready,
  idempotent (dedupe per recipient+record+title). No scheduler built.

Limitations: malware scanning is NOT implemented (documented production
requirement at the storage boundary); retention periods are deliberately
absent (HR/legal policy decision; only "archive, never hard-delete" is
implemented); production storage needs an S3/HDFS-style adapter instead of
the dev local directory.

---

### 5.18 Sprint 18 – Employee Engagement (IMPLEMENTED)

A new `engagement` module provides three backend capabilities on the
existing Employee model (details + test evidence in
[docs/sprints/SPRINT-18.md](./sprints/SPRINT-18.md)):

- **EngagementSurveys** — HR-authored questionnaires with a strictly
  server-enforced lifecycle `Draft → Published → Closed → Archived`
  (bound `Publish`/`Close`/`Archive` actions only; direct PATCH refused).
  Responses only while Published and inside the opening/closing window;
  optional `audienceEmploymentType` targeting; per-employee duplicate rule
  with `Withdraw` + re-Submit as the safe correction route. Answer
  validation per question type (Text / Rating 1–5 / YesNo / Choice).
  Individual answers are **never exposed as an OData collection**
  (`@cds.autoexposed: false`; direct `/SurveyAnswer` GET → 405 even for
  admins) — the only results channel is the aggregate `SurveyResults`
  action (HR-only). **Confidential surveys** additionally never report
  free-text content in any form (count markers only). Draft/Archived
  surveys are invisible to non-HR readers (before-read reject + in-place
  after-read filtering).
- **Suggestions** — employee feedback with a forward-only review lifecycle
  `Submitted → InReview → Accepted/Rejected/Closed` driven by the HR-only
  `Resolve` action; authors may enrich their own row only in `Submitted`;
  reviewers see all, managers see none. Post-review rows lock.
- **Recognitions** — employee-to-employee "kudos"; the sender identity is
  always server-set (payload spoofing ignored), self-kudos refused,
  exact-duplicate submissions refused (retry-safe), content immutable,
  moderation (hide + note) HR-only with stamped `moderatedBy/On`.

Notifications (survey invitation per target audience, suggestion decision,
new kudos) go through the single shared `notify()` core — no duplicated
framework. NOT anonymous by design: the submitter association + audit
trail record identity is kept and access-restricted instead of promising
untraceable anonymity (documented decision, see SPRINT-18.md §4).

---

### 5.19 Sprint 19 – HR Policy Management (IMPLEMENTED)

A new `hr-policy` module provides configurable backend policy management
on the existing Employee/Organization models (details + test evidence in
[docs/sprints/SPRINT-19.md](./sprints/SPRINT-19.md)):

- **Policies + per-version lifecycle** — a `Policy` is the stable identity
  (unique `policyCode`, title, category, owner, applicability scope);
  every `PolicyVersion` carries its OWN lifecycle
  `Draft → InReview → Approved → Published → (Superseded)`, Reject → back
  to Draft, `Published → Withdrawn → Archived` — all transitions are
  bound actions (`SubmitForReview` / `Approve` / `Reject` / `Publish` /
  `Withdraw` / `Archive`) and direct PATCH cannot move a status or touch
  published content. **Header freeze**: once any version leaves Draft the
  policy header (title/category/applicability) is immutable — re-scoping
  or re-wording a published policy requires a new version.
- **Versioning & idempotency** — versions only via the bound
  `CreateVersion` action (nested/deep creates refused); server-assigned
  `versionNo`; copy-forward from the latest version; a `clientRequestId`
  retry returns the existing draft instead of duplicating it. Publishing
  v2 supersedes v1 by STATUS ONLY — acknowledgment records of the old
  version are never touched, so "acknowledged v1" stays provable.
- **Applicability (configurable, never hardcoded law)** — nullable
  company / country / department / employment-type axes (null = no
  restriction). Employee scope resolves through the existing
  `Employee → latest EmployeeHistory → Department → BusinessUnit →
  Company` chain + department `Location.country`. Employees outside the
  scope cannot read or acknowledge the policy (server-enforced).
- **Acknowledgment** — employees acknowledge only a Published, already
  effective, applicable version, only for themselves (identity is
  server-set). Duplicate-safe (same employee × version = same record);
  records are IMMUTABLE (no write grants at all; copies of the accepted
  statement + optional evidence note are stored). Own rows only for
  employees/managers; HR trio may report.
- **Outstanding reporting & reminders** — `OutstandingAcknowledgments` is
  COMPUTED at read time (never stale) against the current published +
  effective version, HR-only (managers get no cross-employee
  acknowledgment data — same line-of-sight as Sprint 17).
  `SendPolicyReminders` is a manual, dedupe-safe trigger for an external
  scheduler (outstanding acks + upcoming `reviewDate` to policy owners);
  notifications ride the shared `notify()` core (category `POLICY`).

Security + lifecycle detail, and the "why not the workflow engine / why
not the Sprint 17 document store" decisions, are documented in
SPRINT-19.md §2.

---

### 5.20 Sprint 20 – HR Support / Helpdesk (IMPLEMENTED)

A new `helpdesk` module provides backend employee support on the existing
Employee/Document/DepartmentHR models (details + test evidence in
[docs/sprints/SPRINT-20.md](./sprints/SPRINT-20.md)):

- **Tickets & lifecycle** — a `HRTicket` (server-generated `TCKxxxx`
  code, server-stamped requester, category, priority) moves ONLY through
  bound actions: `New → Assigned → InProgress → WaitingForEmployee →
  Resolved → Closed`, plus `Reopen` back to InProgress (or New without
  an assignee) with a required reason. `HRTickets` has CREATE but **no
  UPDATE/DELETE grant for anyone** — direct PATCH can never move a
  status, and nothing is ever deleted. Assignments, priority changes
  and every status change append an immutable `HRTicketEvent` history
  row (HR-only read). Reopen keeps the whole trail.
- **Duplicate-safe & idempotent** — same requester + `clientRequestId`
  retries always return 409 pointing at the FIRST ticket; re-Assign to
  the same agent / ChangePriority to the same priority are announced
  no-ops without a duplicate event or notification.
- **Comments with privacy kinds** — `InternalNote` (agents only,
  filtered out of every requester read IN-PLACE — CAP after-READ hooks
  only take in-place changes), `AgentResponse` (stamps
  `firstResponseAt`, the actual-response-time measurement input),
  `EmployeeResponse` (requester only, own ticket only; a waiting ticket
  automatically returns to InProgress when the requester answers).
  Comment rows are immutable; direct CREATE has no grant (403).
- **Requester privacy as the isolation** — non-HR roles read tickets
  and comments only where `requester_ID = $user.employeeId` (grant
  where-clause); the HR trio (the support agents) sees all; managers
  get no cross-employee support data.
- **Configurable SLA targets, computed overdue** — `HRTicketCategorySLA`
  rows (HR-maintained, nullable hours; hardcoded SLA values nowhere) and
  the computed `OverdueTickets` view (HR-only): open tickets past their
  configured response or resolution target, with `hoursOverdue` as
  escalation READINESS — no automatic escalation exists (no scheduler;
  same gap as Sprint 17/19 reminders).
- **Attachment references, not duplicates** — an optional
  `attachedDocument_ID` validated against the Sprint 17 document store
  (the actor may only attach documents they own; HR any). The `Document`
  entity stays exposed ONLY by the employee service — the helpdesk
  carries a validated ID reference so no employee-document surface leaks
  through this service.

Security/lifecycle/SLA detail and all design rationales are documented
in SPRINT-20.md §2.

---

### 5.21 Sprint 21 – Exit Management (IMPLEMENTED)

A new `exit` module provides backend employee-separation on the existing
Employee/Assignment/Asset/Document/Payroll models (details + test evidence
in [docs/sprints/SPRINT-21.md](./sprints/SPRINT-21.md)):

- **The separation case** — an `ExitCase` (server-generated `EXTxxxx`
  code) references the existing `Employee` + the ACTIVE
  `EmployeeAssignment`; carries exit type, sensitive reason, proposed
  AND approved final working dates, the separation date, an HR owner
  and processing indicators. Every status/date/notice move happens ONLY
  through bound actions — `ExitCases` has **no UPDATE/DELETE grant for
  anyone**, so a direct PATCH can never move a status and a completed
  case cannot be silently rewritten (corrections go through the audited
  `Correct` action, HRAdmin/SystemAdmin + reason only).
- **Lifecycle** — `Draft → Submitted → InReview → Approved →
  ClearanceInProgress → ReadyForSeparation → Completed`, plus
  `Withdraw` (cancels the running workflow), `Reconsider` after a
  rejection (resubmit starts a FRESH workflow instance), and the R7
  engine rule so a requester can never sit on their own approval task.
- **Notice period is configuration, never law** — `ExitNoticePolicy`
  (HR-maintained days per exit type) is the only rule source; breaking
  it needs an explicit HR `WaiveNotice` (attributed + audited, never a
  silent date tweak), and a MISSING policy row surfaces as
  `noticePeriodStatus: NotConfigured` instead of being papered over as
  "no notice". No statutory rule exists anywhere in the code.
- **Clearance evidences the REAL world** — checklist items are cloned
  from the HR-maintained ACTIVE `ExitClearanceTemplate`, and completion
  is category-keyed: an `Asset` item requires **zero active
  AssetAssignment rows** (Sprint 14 ledger; the asset return itself
  must go through the asset module's own `returnAsset`), a `Document`
  item requires ≥1 linked required `ExitCaseDocument` (a validated LINK
  to an Active Sprint 17 document — the bytes never leave that store).
  Mandatory items gate `MarkReadyForSeparation` AND `CompleteExit`;
  optional items can be skipped only by HRAdmin/SystemAdmin with a
  reason.
- **Employee-side visibility** — `ExitCases` READ is scoped
  `employee_ID = $user.employeeId` for the employee classes, full for
  the HR trio; managers deliberately get no line of sight (sensitive
  personal data — the approver operates through the workflow task
  surface instead). EmployerInitiated cases are HR-only to create and
  mask the sensitive reason on every non-HR read.
- **Computed asset view** — `DepartingEmployeeAssets` (HR-only,
  computed at read time from the real ledger) shows which assets the
  departing employee still holds, feeding the Asset clearance item.
- **Evidence-gated payroll outcome** — `RecordFinalSettlement` flips
  the case's `payrollStatus` only when a PROCESSED/APPROVED
  `ProcessPayroll` row actually covers the separation month; without
  evidence it refuses. The module never recomputes settlement
  components.
- **Employment flips only at completion** — `CompleteExit` is the
  ONLY place `Employee.status` becomes `Inactive` (+ relievingDate);
  HR contacts registered in `DepartmentHR` require SystemAdmin to
  deactivate. No external account-revocation is claimed anywhere.
- **Notifications/audit** — category `EXIT` via the shared `notify()`
  (neutral text for employer-initiated cases); audited transitions via
  the shared `persistAudit` + generic hooks; `ExitEvent` rows keep the
  business history (HR-only read) and the appended-only design is
  asserted by tests.

Security/lifecycle/notice/clearance detail and all design rationales
are documented in SPRINT-21.md §2.

---

### 5.22 Sprint 22 – Dashboard & Analytics (IMPLEMENTED)

The `dashboard` module provides aggregate analytics computed at read
time (details + test evidence in
[docs/sprints/SPRINT-22.md](./sprints/SPRINT-22.md)):

- **Ten computed entities** — `WorkforceStatus`, `HeadcountByDepartment`
  (DISTINCT employees per the LATEST-EmployeeHistory department rule),
  `LeaveTypeUsage`, `AttendanceByStatus`, `RecruitmentFunnel`,
  `PerformanceStatus`, `AssetSummary` (+ ACTIVE assignment count),
  `HelpdeskSummary` (status + priority), `ExitSummary`, and
  `DocumentExpiryOverview` (Active/expiring/expired per type with the
  Sprint 17-configured alert windows — never a hardcoded default).
- **One metric source of truth** — every number is computed by the
  shared `srv/common/utils/analytics-queries.js` helpers, which the
  Sprint 23 Reports service reuses; the two surfaces cannot drift.
- **Management visibility** — READ for HR/finance/management roles,
  denied for plain employees (aggregates are organizational
  information); handlers re-check roles server-side (same double-lock
  as the helpdesk reporting).

### 5.23 Sprint 23 – Reports & Export (IMPLEMENTED)

The `reports` module provides nine computed report entities + a CSV
export at `/odata/v4/reports` (details + command examples in
[docs/sprints/SPRINT-23.md](./sprints/SPRINT-23.md)):

- **Reports** — Workforce (per-employee structure), Attendance,
  Leave, Recruitment, Performance, Assets (with the ACTIVE-assignment
  custody), DocumentExpiry, Helpdesk, Exit. All computed at read
  time; no duplicated entities; sensitive fields (compensation,
  reasons, personal contact data) never appear.
- **Server-side filtering** — `$filter` must name the entity's own
  columns; the report's date axis uses ordinary `ge`/`le` operators;
  only `eq`/date-range ops are honored, so filters can never expand a
  report into a row-security bypass. Date ranges are validated (both
  bounds together, from ≤ to, ≤ 366 days; UTC-day semantics on plain
  ISO dates).
- **Pagination/limits** — `$top` honored server-side and clamped to
  250 interactive rows; the export takes an explicit `limit`
  (≤ 10,000) and REFUSES oversized reports with 413 — never silently
  truncated.
- **CSV export** — `POST /ExportCSV` (typed parameters mirroring the
  filters, same builders as the reads); RFC-4180 quoting, and
  spreadsheet formula-injection protection (`=`,`+`,`@`,tab and
  formula-like `-` leads get a guard apostrophe; plain numbers like
  `-5` are untouched). Returns the CSV text as the OData string value
  with a `Content-Disposition` filename
  (`ewms-<report>-<yyyymmdd>.csv`, no personal data). Exports are
  audited (facts only, no report contents).
- **Authorization** — HR trio + SystemAdmin on all reports;
  FinanceManager additionally on Assets; employees AND managers are
  denied (their scoped views live in their own modules — the report
  surface must not become a proxy for other employees' rows).

### 5.24 Sprint 24 – Background Jobs & Scheduled Processing (IMPLEMENTED)

The `jobs` layer automates repetitive reminders by deciding **when**
eligible work is processed — it never re-implements business rules
(details + commands in [docs/sprints/SPRINT-24.md](./sprints/SPRINT-24.md)):

- **Three jobs** (each registered in [srv/jobs/registry.js](../srv/jobs/registry.js)
  only because its business rules already exist in a module):
  `document-expiry` (verified documents expiring within the window or
  already expired + missing mandatory requirement documents — rules
  owned by the Sprint 17 compliance module), `workflow-approvals`
  (open WorkflowTasks due soon or overdue, reminded to their resolved
  approver) and `timesheet-drafts` (timesheets still Draft after their
  period fully ended). Eligibility comes from real business data;
  no job changes business status, escalates, or invents records.
- **Reuse over duplication** — the document-expiry rules were extracted
  into [compliance-rules.js](../srv/compliance/handlers/compliance-rules.js),
  which BOTH the manual action `NotifyDocumentExpiries` and the job
  call — one rule set, two entry points, no drift.
- **Idempotency, no new tables** — dedupe checks the existing
  `Notification` rows (recipient + title + business record ID) before
  sending, so re-running a job can never duplicate a reminder.
  Execution history is a bounded in-memory list (last 50 runs,
  cleared on restart) — no database entity was added for cosmetic
  logging; durable history is a documented production deferral.
- **Three entry points, one engine** — CLI `node srv/jobs/run-job.js
  <job> [--window N] [--as-of YYYY-MM-DD]` (in-memory deploy
  restricted strictly to `:memory:` databases, never to dev
  `db.sqlite`); SystemAdmin-only HTTP API `POST /odata/v4/jobs/RunJob`
  and `GET /odata/v4/jobs/JobRuns`; env-gated scheduler
  (`EWMS_JOBS_ENABLED=true`, `EWMS_JOBS_INTERVAL` minutes, default 60)
  in [srv/jobs/scheduler.js](../srv/jobs/scheduler.js) — **off by
  default, never active under `CDS_ENV=test`**, timer `unref()`'d and
  cleared on shutdown, overlapping ticks skipped.
- **Safety rails** — one job at a time per process (409
  "already running", a documented SINGLE-INSTANCE assumption); a hard
  cap of 500 rows per job pass (`MAX_ROWS_PER_JOB_RUN`); invalid
  parameters rejected with clear 400s before anything runs; each run
  is ONE transaction (everything or nothing); raw error text is
  stripped from history reads and logs show only sanitized one-line
  summaries — no SQL, paths, payloads or personal data.
- **Single-instance truth** — multi-instance scheduling, external
  email/SMS delivery and durable job history are consciously deferred
  and documented in [SPRINT-24.md §9](./sprints/SPRINT-24.md).

### 5.25 Planned modules (not implemented)

The following are **on the roadmap only** — names and intended scope appear in earlier docs/comments, but **no code, CDS entities, security definitions, or tests exist for them in the repository**. Treat every statement here as **Planned**, not implemented:

| Sprint (roadmap name) | Intended scope (from previous docs/comments, not from code) |
|---|---|
| ~~Sprint 15~~ | **IMPLEMENTED** — see §5.15 (Timesheet) |
| ~~Sprint 16~~ | **IMPLEMENTED** — see §5.16 (Geo Tracking & Geo-Fencing); shift-scheduling *UIs* remain roadmap items |
| ~~Sprint 21~~ | **IMPLEMENTED** — see §5.21 (Exit Management) |
| ~~Sprint 24~~ | **IMPLEMENTED** — see §5.24 (Background Jobs & Scheduled Processing) |

The `readme.md` includes an even broader aspirational list (dashboard, reports, Fiori apps, BTP deployment). None of it is present in the repo. The `AttendanceStatus` enum contains `Timesheet`-adjacent vocabulary (`WorkFromHome`, `OnDuty`, `HalfDay`) that is already in use by the attendance module, and shows how later timesheet features could reuse it — but no timesheet entity exists.

> **Distinguish clearly**: `Employee` + `Department` + `Designations` + `Assignments` + `Attendance` + **Timesheet** + **Geofencing** + **Documents & Compliance** + **Employee Engagement** + **HR Policy Management** + **HR Support / Helpdesk** + **Exit Management** + **Dashboard & Analytics** + **Reports & Export** + **Background Jobs** are implemented. Rostering *UIs*, external email sending, Fiori UIs, BTP deployment remain **planned** as of this documentation.

---

## 6. Permissions and security matrix

All claims are grounded in `*-security.cds` files, handler code, and tests. Where a permission is **not** directly covered by a test, it is explicitly marked _(_requires verification_)_.

Legend: ✅ granted · ❌ denied · 🔓 handler-rechecked (annotation grants it, the handler re-validates per row)

### 6.1 Role × module matrix

| Module \ Role | Employee | DeptMgr | ProjMgr | HRExec | HRAdmin | FinMgr | PayExec | SysAdmin |
|---|---|---|---|---|---|---|---|---|
| Organizations | R* | R | R | R | CRUD | R | R | CRUD |
| DepartmentHRs | ❌ | ❌ | ❌ | R | CRUD | ❌ | ❌ | CRUD |
| Employees | R (own) | R (project-dept) | R (project-dept) | R | CRUD | R | ❌ | CRUD |
| Designations/Grades | R | R | R | R | CRUD | R | R | CRUD |
| Assignments | ❌ | R | R | R | CRUD | ❌ | ❌ | CRUD |
| Banks (own) | R/C/U | ❌ | ❌ | C/R/U/D | C/R/U/D | C/R/U/D | ❌ | C/R/U/D |
| Documents (own) | R/C | ❌ | ❌ | ❌ | R/U/D | R* | ❌ | R/U/D |
| Educations/Experiences (own) | R/U | ❌ | ❌ | R | R | ❌ | ❌ | R |
| StatutoryDetails (own) | R | ❌ | ❌ | ❌ | CRUD | ❌ | ❌ | CRUD |
| Attendance | R/C/U (own) | R/U (scope) | R (scope) | R | CRUD | ❌ | ❌ | CRUD |
| Overtime | R/C (own) | R/U | R | R | CRUD | ❌ | ❌ | CRUD |
| Shifts / Holidays / WorkSchedules | R | R | R | R | CRUD | R | R | CRUD |
| LeaveRequests | R/C/U/D own + StartWorkflow | R/U dept-scope + StartWorkflow | StartWorkflow | StartWorkflow | CRUD + StartWorkflow | ❌ | ❌ | CRUD + StartWorkflow |
| LeaveApprovals | R (via leave) | R/U | ❌ | R/U | CRUD | ❌ | ❌ | CRUD |
| LeaveBalances | R (own) | ❌ | ❌ | ❌ | CRUD | ❌ | ❌ | CRUD |
| LeaveTypes / LeavePolicies | R | R | R | R | CRUD | R | R | CRUD |
| ApprovalHistories | ❌ | R | ❌ | ❌ | R | ❌ | ❌ | R |
| Salary config (Components/Structures) | ❌ | ❌ | ❌ | ❌ | CRUD | R | ❌* | CRUD |
| EmployeeSalaries | ❌ | ❌ | ❌ | ❌ | CRUD | R | ❌ | CRUD |
| PayrollPeriods/Processes | ❌ | ❌ | ❌ | R | R | R/actions | R/CUD/actions | R/actions |
| Payslips | R (own only) | ❌ | ❌ | ❌ | CRUD + Publish | ❌* | CRUD | CRUD + Publish |
| PayrollDetails/Histories | ❌ | ❌ | ❌ | ❌ | R | R | ❌ | R |
| WorkflowDefinitions/Steps | R | R | R | R | CRUD | R | R | CRUD |
| WorkflowInstances | R/action: Cancel/Resubmit | R | R | R | R | R | R | Cancel/Resubmit |
| WorkflowTasks | R/actions* (own only, handler-locked) | R/actions | R/actions | R/actions | R/actions | R/actions | R/actions | everything |
| WorkflowHistories | ❌ | R | R | R | R | R | R | R (no writes) |
| WorkflowDelegations | C/R/U/D own | C/R/U/D own | C/R/U/D own | C/R/U/D own | all | C/R/U/D own | C/R/U/D own | all |
| Notifications | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead | R own + MarkAsRead + CreateNotification |
| Candidates / Offer entities | ❌ | R (CTC-masked, own offers only) | R (CTC-masked, own offers only) | R + actions | CRUD + actions | R | ❌ | CRUD + actions |
| OnboardingTasks | R/Start/Complete own | R/Start/Complete own | R/Start/Complete own | full | full | ❌ | ❌ | full |
| PerformanceReviews | R own (as employee/reviewer) + AddEmployeeComments + StartReview/Evaluate (if reviewer) | same | same | R/CRUD/actions | R/CRUD/actions | ❌ | ❌ | full |
| PerformanceGoals | R own + lifecycle (if assigner) | same | same | R/CRUD/actions | R/CRUD/actions | ❌ | ❌ | full |
| AssetCategories | R | R | R | R | CRUD | R | R | CRUD |
| Assets | R (own held) | R (held) | R (held) | full | full | R | R | full |
| AssetAssignments | R own + Ack | R own + Ack | R own + Ack | full | full | ❌ | ❌ | full |
| AssetEvents | ❌ | ❌ | ❌ | R | R | ❌ | ❌ | R |
| AuditLogs (via EmployeeService) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | R |
| Timesheets (Sprint 15) | R/C/U/D own + Submit/Withdraw/Cancel/StartWorkflow | R (their reports) + StartReview/Approve/Reject | R (their reports) + review actions | R + full lifecycle | R + full lifecycle (incl. Reopen) | ❌ | ❌ | R + full lifecycle |
| Geofences (Sprint 16) | R | R | R | R | CRUD + Activate/Deactivate | R | R | CRUD + Activate/Deactivate |
| LocationEligibilities (Sprint 16) | R own | ❌ | ❌ | R (read) | CRUD | ❌ | ❌ | CRUD |
| AttendanceLocationEvents (Sprint 16) | R own | ❌ | ❌ | R | R | ❌ | ❌ | R (no writes for anyone) |
| ExitCases (Sprint 21) | R (own) + create/submit own | ❌ | ❌ | R + HR lifecycle actions | R + Correct/SkipItem | R (own, create) | R (own, create) | full |
| ExitChecklistItems / ExitEvents (Sprint 21) | R own rows (Items only) | ❌ | ❌ | R + item actions | R + SkipItem | ❌ | ❌ | R + item actions |
| DepartingEmployeeAssets (Sprint 21) | ❌ | ❌ | ❌ | R | R | ❌ | ❌ | R |
| Exit config (Templates/NoticePolicies) | ❌ | ❌ | ❌ | CRUD (Templates read) | CRUD | ❌ | ❌ | CRUD |
| Jobs: RunJob / JobRuns (Sprint 24, admin only) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | all (tested: employee + HR denied) |

Notes on specific cases:
- **`Read all roles`** for organization master data is deliberate — picklists need it.
- **`SalaryStructures` for PayrollExecutive is explicitly ❌** — the regression test verifies 403 (`PayrollExecutive cannot read salary structures`).
- **`Payslips` for FinanceManager is ❌ for CREATE/UPDATE/DELETE but HRAdmin + SystemAdmin only for `PublishPayslip`** — the regression test verifies FINMGR cannot unlock a locked payroll (403) and the `PublishPayslip` action is HRAdmin + SystemAdmin only.
- **`Bank` full CRUD for FinanceManager** is in the CDS but **not covered by an automated test** — _(_requires verification if critical_)_.
- **Workflow task visibility** for a plain Employee exists only through row-level engine enforcement (`assertTaskAccess`), not through `@restrict` — a non-assignee Employee's row-level READ may still return other instances' rows unfiltered in list queries if they match only the broad service-level grant; the engine guards task **actions** specifically. This nuance is documented in the `workflow-security.cds` comments themselves and **requires care when reading lists**.

### 6.2 Notable protective rules (all tested)

1. **Employees cannot read other employees at all** — 403 on their READ request, verified in `test/regression-s1-11.test.js`.
2. **Sensitive payroll data is invisible to plain employees** — no path at all to `EmployeeSalaries` or `PayrollPeriods` for `Employee` (403), verified.
3. **Payroll config (salary structures)** is not readable by PayrollExecutive either — verified 403.
4. **`ConvertToEmployee`, `ApproveOffer`, `RejectOffer`** are HRAdmin/SystemAdmin-only (no HREncutive for the direct-offer approval fallback; Convert is admin-only because creating employees is sensitive).
5. **Workflow history is immutable** — engine throws 400 on UPDATE/DELETE attempts.
6. **Direct status changes are blocked everywhere a lifecycle exists**:
   - LeaveRequests — direct PATCH may only set `Cancelled` (approve/reject must be through LeaveApprovals); core fields frozen after operational status.
   - Asset — all status/condition/holder changes via actions; disposed is immutable.
   - Reviews — frozen once Completed; no direct PATCH lifecycle moves.
7. **Self-service boundary (self-write guard)** — a plain employee can never CREATE someone else's leave/attendance. Any admin/HR/manager/finance role bypasses this rule (they already have unrestricted CRUD in the CDS).
8. **Workflow self-approval guard** — a requester can never approve their own workflow unless the definition allows it (`allowSelfApproval`).
9. **Onboarding documents** — HR trio only, so `Plain Employee` never touches them.
10. **Compensation masking** — DepartmentManager sees offers they manage, but the CTC field is masked in code for them. Verified in tests.
11. **Geofence evidence is server-generated and coordinate-free in attendance reads** — evidence rows cannot be created/updated/deleted by ANY role (no write grant; 403 tested), and the geo fields on Attendance are `@cds.persistence.skip`, so attendance responses never carry coordinates. Failed (rejected) evaluations are never persisted. Verified in `test/geo.test.js`.

### 6.3 Where the security "lives"

| Concern | File (inspect for exact grants) |
|---|---|
| Service/entity/action grants, row-level where clauses | `srv/<domain>/<domain>-security.cds` (one per module) |
| Handler re-checks (task access, self-write, idempotency, masking) | `srv/<domain>/handlers/*.js`, `srv/common/utils/self-write-guard.js` |
| Role definitions | `srv/common/auth/roles.js`, `package.json` (`cds.requires.auth`), `xs-security.json` |
| User-attribute (employee/dept) resolution | `srv/middleware/resolve-employee-context.js` |
| Role bypass / group checks | `srv/common/auth/authorization.js`, `role-groups.js` |
| Audit (who did what, sensitive redaction) | `srv/common/utils/audit.js`, `db/common/audit-log.cds` |

---

## 7. End-to-end business workflows

Five cross-module flows are **verified by automated tests**. Each is described with the actors, state transitions, authorization checkpoints, and error paths. Future integrations are marked planned and clearly separated.

### 7.1 Employee creation and organization assignment (implemented)

1. HRAdmin/SystemAdmin creates a `Department` (auto DEP code), `Designation`, `Grade` in the organization/employee services.
2. HRAdmin creates an `Employee` — required fields validated, email checked for duplicates, EMP code generated. `status: Active`.
3. HRAdmin links the employee into a `Project`/`Team` via `EmployeeAssignment` (project, team, designation, grade, reportingManager, fromDate/toDate, isActive) — this assignment is what approval flows later use to find the reporting manager.
4. Employee's profile details (bank, education, experience, statutory) are added by the employee (self-CREATE per role grants).

Authorization: HRAdmin + SystemAdmin only for Employees/Aux CRUD. Employee READs their own row, managers READ project-department scopes.

Parity check in tests: creating employee with required-field or email validations in [regression-s1-11.test.js](../test/regression-s1-11.test.js) + duplicate-email checks.

### 7.2 Attendance and leave processing (implemented)

**Attendance** (self-service):
1. Employee checks in — one `Attendance` row per employee/date; shift resolution goes through WorkSchedule → ShiftAssignment → error.
2. During the day they can PATCH their own row (updates last to allow late-leave tracking).
3. Check-out via `checkOut` triggers field protection rules (immutable `shift_ID`, computed `workedHours`).
4. Manager may UPDATE rows in their project-department scope; HR can change anything.

**Leave** (self-service + approval):
1. Employee creates a `LeaveRequest` — overlap guard, half-day, total-days calc, auto `LV...` code, **pending balance reservation** (pendingDays += totalDays).
2. Either *direct approval* — a DepartmentManager/HRExecutive acts on a `LeaveApproval` — or *generic workflow* — the employee calls bound `StartWorkflow` on their own request; the engine creates an instance per `WF-LEAVE-STD` (2 steps: Manager → LevelHR). Step 1 approver = reporting manager; step 2 = department HR (seeded: `finmgr`).
3. Approvers act through `/odata/v4/workflow/WorkflowTasks(ID=...)` (`Approve/Reject/SendBack/Delegate/Reassign`).
4. On final workflow decision, callbacks sync leave status (`Approved/Rejected/Cancellation`, Rework reverts to editable).
5. `Cancel` (or workflow cancel) **releases reserved balances** based on current status.

Errors: 409 (workflow already open), 400 (overlap, insufficient, cancelled), 403 (self-write guard / department-scope where).

Tests: `test/regression-s1-11.test.js` (request create, overlap-, self-scope tests) + workflow paths exercised implicitly through the leave module integration tests.

### 7.3 Payroll configuration and period lifecycle (implemented)

1. HRAdmin/FinanceManager maintain `SalaryComponent`/`SalaryStructure`/`SalaryStructureItem` and `EmployeeSalary` rows.
2. PayrollExecutive runs `ProcessPayroll` on a `PayrollPeriod` → per-employee `PayrollProcess` rows.
3. FinanceManager uses `ApprovePayrollBatch` (or `RejectPayroll(reason)` to loop back).
4. FinanceManager runs `LockPayroll` (period) — only SystemAdmin can `UnlockPayroll`.
5. HRAdmin/SystemAdmin `PublishPayslip` — the payslip becomes visible to the employee under their self-scope.

Errors: 403 (role) at each step, 400 (invalid transition / invalid parameters), publication is admin-only.

Tests: `test/regression-s1-11.test.js` (Sprint 8 block — locking, unlocking, role enforcement).

### 7.4 Generic workflow approval and notification delivery (implemented)

A generic approval exists **as its own reusable engine** (Sprint 10):

1. The module's action (`SubmitForApproval`, `SubmitReview`, or the Leave bound `StartWorkflow`) calls `startWorkflow` with `businessObjectType` + `businessObjectId`.
2. `startWorkflow` validates (a) definition must be Active (else 404), (b) **one open instance per object** (else 409), (c) business object must exist. It creates the instance (`Running`) and step-1 tasks via `openStep` — including automatic skip-forward for empty/dead steps.
3. Approvers see and act on `WorkflowTasks`; `assertTaskAccess` only lets the assignee / authorized delegate / SystemAdmin act on a given task.
4. `Approve` — SingleSequential moves instance → next step (or `Approved` at the end); `AllMustApprove` waits; `AnyCanApprove` first-wins. `Reject` finalizes the instance. `SendBack` moves it to `Rework`; requester-only `ResubmitWorkflow` reopens step 1 on the **same** instance.
5. Every transition writes a `WorkflowHistory` row (append-only) — compliance audit trail.
6. On Approved/Rejected/Cancelled/Rework, module callbacks sync the business object (offer status, review status, leave status). Notification delivery is module-level through `notify()`.
7. `CancelWorkflow` (requester/HR) finalizes; open tasks are closed with `Cancelled`.

Errors: 403 (not assignee/delegate, or requester acting without allowSelfApproval), 409 (start-duplicate), 400 (missing comments, immutable history, direct status mutation).

Tests: workflow approvals are exercised in `test/recruitment.test.js` + `test/performance.test.js`; engine guards in `test/regression-s1-11.test.js`.

### 7.5 Recruitment → offer → onboarding → employee conversion (implemented)

Full happy path (all automated in `test/recruitment.test.js`):

1. HR creates a `Candidate` (auto CAND code, status `New`).
2. HR creates an `Offer` (auto OFF code; department, designation, reportingManager, dates, offeredCTC).
3. HR (`SubmitForApproval`) — Draft → PendingApproval and **starts the generic workflow** (`WF-OFFER-STD`, one LevelHR step; approver = `finmgr`).
4. The approver `Approve` the workflow task → offer status `Approved` (module callback).
5. HR `SendOffer` — status `Sent`, `sentOn` stamped.
6. HR `RecordAcceptance` — status `Accepted`, `acceptedOn` set, **OnboardingCase auto-created** (ONB code, NotStarted), tasks seeded from the standard checklist and document requirements created.
7. HR `StartOnboarding` — case InProgress.
8. HR (or the assignee) works tasks (`StartTask` → `CompleteTask`) and documents (`SubmitDocument` → `VerifyDocument`); mandatory items can't be skipped; the case can't complete while anything mandatory is open (`CompleteOnboarding` 400).
9. HR calls `CompleteOnboarding` — case Completed.
10. HRAdmin/SystemAdmin calls `ConvertToEmployee` — creates the employee (via the standard Employee entity, EMP code) + an active assignment, links it to the case, marks the candidate `Hired`. **Idempotent** — calling again returns "linked" and never duplicates.

Error / authorization checkpoints: 403 (plain employee on candidates/offers/Convert), 409 (double approval while workflow running), 400 (skip mandatory task, expire while Draft, active-state block; invalid offer transitions), CTC masked for DepartmentManager.

### 7.6 Performance review with ratings and goals (implemented)

All automated in `test/performance.test.js`:

1. HR creates a `PerformanceReview` (auto REV code; employee, reviewer, type, period). Blocked: duplicate open review for the same employee+type+period (409), self-review (400).
2. HR `SubmitReview` → starts **WF-REVIEW-STD** (LevelHR step; approver `finmgr`); review status `PendingReview`.
3. The reviewer `StartReview` (their own assignments only) → `InReview`.
4. Reviewer `SubmitEvaluation(overallRating, comments)` — rating restricted to the 5-level enum; → `Submitted`.
5. The LevelHR approver `Approve` the workflow task → callback syncs review status `Approved`. (`ApproveReview` — direct HR fallback only, 409 while workflow running.)
6. `CompleteReview` → status `Completed`, review **frozen** (no further changes).
7. Employee can `AddEmployeeComments` on their own review before freeze.
8. Goals live alongside: `ActivateGoal` → `CompleteGoal(achievement, rating)` → can't exceed valid rating values; `CancelGoal` only from Draft/Active.

Errors: 409 (duplicate open review, Direct Approval while in workflow), 400 (invalid rating, frozen mutations, self-review), 404 (an Employee reading another person's review — row-level filter).

### 7.7 Asset lifecycle (implemented)

All automated in `test/asset.test.js`:

1. HRAdmin creates the `AssetCategory` and an `Asset` (auto AST code; serial number enforced unique via handler).
2. HR `assignAsset(employee_ID, conditionAtAssignment, ...)` — Available → Assigned; Active assignment row created; employee notified; assignment **ACK** row also created; audit/event logged.
3. Receiving employee `AcknowledgeAssignment` (own row only; idempotent).
4. HR may `transferAsset(newEmployee_ID, ...)` — closes the current Active row and opens a new one; the asset itself stays `Assigned` but `currentHolder` changes; new holder notified.
5. HR `returnAsset(condition, ...)` — returns; condition Damaged/Critical routes the asset to `InRepair` automatically.
6. Condition-decisions: `inspectAsset` blocks while assigned; the outcome drives `Available / InRepair / RetireRecommended / DisposeRecommended` (the latter two route to `retireAsset`/`disposeAsset`).
7. Repair cycle: `startRepair(vendor)` → `InRepair`; `completeRepair(condition, repairCost, vendor)` → back to `Available`.
8. Missing/damaged: `markLost(reason)` / `markDamaged(condition, reason)`; on lost, **the Active assignment stays open** for accountability; the holder is notified.
9. End of life: `retireAsset` → Retired; `disposeAsset` → `Disposed` (final, immutable).

Errors: 409 (idempotency, double-assign), 400 (blocked while Assigned, missing reason, negative cost), and lifecycle transitions never happen via plain PATCH.

### 7.8 Timesheet & geofenced check-in flows (implemented — see §5.15/§5.16); roster UIs & document uploads remain **Planned**

No implementation exists (no entity, no action, no test). Only vocabulary — the `AttendanceStatus` enum includes `WorkFromHome / OnDuty / HalfDay`, and the notification category `TIMESHEET` is reserved. Anything about timesheets/rosters beyond this is a future roadmap item.

### 7.9 Exit processing and asset-return integration — **Planned**

Not implemented per se. The asset module already stores per-employee **assignment history** closed traps (`AssetAssignment` rows never deleted) and the `currentHolder` mirror — this is exactly what Sprint 21's Exit Management consumes: the computed `DepartingEmployeeAssets` view and the Asset clearance item key off ZERO-active-assignment evidence from this data.

---

## 8. Shared services and common rules

### 8.1 Generic workflow engine

Owner: [workflow-engine.js](../srv/workflow/handlers/workflow-engine.js) (all state transitions — see [Sprint 10](#510-sprint-10--generic-workflow-engine)).

Responsibility split:
- **Engine**: definition/start/step/tasks/history/delegations; the **only** code allowed to change instance/task status.
- **Module**: lifecycle of its own business object; starts the workflow via a StartWorkflow call; implements `applyDecision`/`applyRework`/`applyResubmit` callbacks; sends its own notifications.

### 8.2 Notifications

Owner: [notification-core.js](../srv/notification/handlers/notification-core.js) (shared `notify()` helper) + [notification-service.js](../srv/notification/notification-service.js) (+ [security](../srv/notification/notification-security.cds)).

- **Shared rule**: modules **must** use `notify()` — no module writes notification rows directly. Keeps category/priority/status handling consistent.
- **Read access**: only the recipient, enforced by `@restrict` (`recipient_ID = $user.employeeId`).
- **Reading status** is a one-way lifecycle (`Unread → Read`); the Read handler prevents going back.
- **CreateNotification** is an admin-only back-door for tooling — business flow never uses it.
- `notify()` **never throws** — a broken inbox write cannot break a business action (deliberate trade-off, documented in the file).

### 8.3 Audit logging

Owner: [audit.js](../srv/common/utils/audit.js) + the `AuditLog` entity in [audit-log.cds](../db/common/audit-log.cds); rows read via the `AuditLogs` projection on `EmployeeService` (SystemAdmin only).

- Opt-in per service: each domain's `service.js` calls `registerAuditHooks(this, { include: [...] })`.
- Handles CREATE / UPDATE / DELETE snapshots; PATCH merged state; **sensitive fields redacted** (password/token/pan/aadhaar/passport/bank/salary/amount/percentage/rate, case-insensitive).
- **Never blocks** business transactions: `persistAudit` catches its own errors.
- `correlationId` from request headers enables trace-linking across services.

### 8.4 Authorization utilities

Owner: [authorization.js](../srv/common/auth/authorization.js) + [role-groups.js](../srv/common/auth/role-groups.js) + [roles.js](../srv/common/auth/roles.js).

- Standard way for **handler code** to ask "is this user HR?" (`hasGroup(req, 'HR')`), "is this user a ProjectManager?" (`hasRole(req, 'ProjectManager')`), "is this a system admin?" (`isSystemAdmin(req)`).
- SystemAdmin bypasses every group/role check — consistent with `@restrict` where SystemAdmin is often granted explicitly.

### 8.5 Employee-context resolution

Owner: [resolve-employee-context.js](../srv/middleware/resolve-employee-context.js) + [employee-context-cache.js](../srv/common/utils/employee-context-cache.js).

- Bridges IAS (production) identities to employee records (via the `AppUsers` table) with a TTL cache; dev/test mocked users fall back to the values declared in `package.json`.
- Fills `req.user.attr.employeeId` / `.departmentId` — these **power every row-level `@restrict` where-clause** and every self-service handler.

### 8.6 Number / code generation

Owner: [code-generator.js](../srv/common/utils/code-generator.js).

- `generateCode(req, entity, field, prefix, length)` — reads the last row ordered by the code field, increments, pads. Format: `COMP0001`, `EMP000001`, `PROJ0001`, `TEAM0001`, `DEP0001`, `LV000001`, `SHIFT00001`, `AST0001`, `CAT0001`, `CAND0001`, `OFF0001`, `ONB0001`, `REV0001`, `GOAL0001`.
- Not concurrency-safe by design (single-node dev tool); acceptable here because codes are also protected by `@assert.unique` on the model + per-module handler checks (e.g. serial-number duplicate check in asset-master.js).

### 8.7 Duplicate prevention, idempotency, status transitions

- **Duplicate checks**: `srv/common/utils/duplicate.js` (`exists()`), plus per-module handlers (leave overlap test, employee duplicate email, employee duplicate serial, duplicated leave type,.component etc.).
- **Idempotency** is deliberate only where business requires it, always in a handler:
  - `ConvertToEmployee` (recruitment) — repeated calls never create a second employee.
  - `MarkAsRead` (notification) — re-calling is a no-op.
  - `AcknowledgeAssignment` (asset) — repeated ack does not double-write.
  - Assets lifecycle actions return **409** on double-assignment / closed-state actions — safe retries.
  - Workflow instances — 409 "already has an instance running" prevents duplicate approvals.
- **Status transition guards**: CAP's `@restrict` **filters READs**, not CREATEs — so the [self-write-guard.js](../srv/common/utils/self-write-guard.js) exists specifically for the CREATE gap. Other transitions are handler-enforced state machines (offer, onboarding, review, asset, leave). Direct-PATCH lifecycle moves are blocked whenever the entity has a state machine.
- **Multiple-error policy**: handlers prioritize business-critical guard rejection first (e.g. the self-write guard runs **before** required-field checks), so the clearest failure surfaces instead of an opaque aggregated 400.

### 8.8 Background jobs and external integrations

- **No scheduler, no BTP jobs, no SMTP sender, no outbox** — `cds.requires.outbox: false`; notifications are synchronous. The `NotificationChannel.EMAIL` enum value exists but the sender is a planned integration (documented above).
- Audit + notifications run in-request; both **never abort** the business action (swallowed-error pattern in both helpers).

---

## 9. API, data, and configuration reference

### 9.1 Registered OData services

All services are registered in [srv/services.cds](../srv/services.cds). Base URL in dev: `http://localhost:4004`.

| # | Service | Path | Entities exposed |
|---|---|---|---|
| 1 | `AttendanceService` | `/odata/v4/attendance` | Attendances, Shifts, HolidayCalendars, Holidays, Overtimes, ShiftAssignments, WorkSchedules |
| 2 | `EmployeeService` | `/odata/v4/employee` | Employees, Designations, Grades, EmployeeAssignments, EmployeeHistory, Banks, Educations, Experiences, Documents, StatutoryDetails, **AuditLogs** (SystemAdmin-only projection) |
| 3 | `OrganizationService` | `/odata/v4/organization` | Companies, BusinessUnits, Locations, Departments, DepartmentHRs |
| 4 | `ProjectService` | `/odata/v4/project` | Projects, ProjectManagers |
| 5 | `TeamService` | `/odata/v4/team` | Teams, TeamManagers |
| 6 | `LeaveService` | `/odata/v4/leave` | LeaveTypes, LeaveRequests (+StartWorkflow), LeavePolicies, LeaveBalances, LeaveApprovals, ApprovalHistories |
| 7 | `PayrollService` | `/odata/v4/payroll` | SalaryComponents, SalaryStructures, SalaryStructureItems, EmployeeSalaries, PayrollPeriods (4 actions), PayrollProcesses (2 actions), PayrollDetails, Payslips (1 action), PayrollHistories |
| 8 | `WorkflowService` | `/odata/v4/workflow` | WorkflowDefinitions, WorkflowSteps, WorkflowInstances (2 actions), WorkflowTasks (6 actions), WorkflowHistories, WorkflowDelegations, unbound StartWorkflow |
| 9 | `NotificationService` | `/odata/v4/notification` | Notifications (+MarkAsRead), unbound CreateNotification |
| 10 | `RecruitmentService` | `/odata/v4/recruitment` | Candidates, Offers (9 actions), OnboardingChecklists, OnboardingChecklistItems, OnboardingCases (6 actions), OnboardingTasks (5 actions), OnboardingDocumentRequirements (4 actions) |
| 11 | `PerformanceService` | `/odata/v4/performance` | Reviews (7 actions), Goals (3 actions) |
| 12 | `AssetService` | `/odata/v4/asset` | AssetCategories, Assets (10 actions), AssetAssignments (1 action), AssetEvents |
| 13 | `TimesheetService` | `/odata/v4/timesheet` | Timesheets (8 actions: Submit, StartReview, Approve, Reject, Withdraw, Cancel, Reopen, StartWorkflow), TimesheetItems, TimesheetHistories (read-only ledger) |
| 14 | `GeoService` | `/odata/v4/geo` | Geofences (ActivateGeofence/DeactivateGeofence), EmployeeLocationEligibilities, AttendanceLocationEvents (server-written evidence, no write grants), GeofenceHistories (append-only) |

Multi-service note: `npx cds compile srv --to edmx` errors with *"multiple service definitions"* in this project — **expected**; compile per service (`npx cds compile srv/<domain>/<domain>-service.cds --to edmx`) or use `--to csn` for the whole model.

### 9.2 Important relationships (cross-module)

```
Employee ── compositions ──> Bank, Education, Experience, Document, StatutoryDetail
Employee ── assignments ──> Project, Team, Designation, Grade, reportingManager→Employee
Department ── DepartmentHR ──> Employee  (LevelHR resolution in workflow engine)
LeaveRequest ──> Employee, LeaveType
LeaveBalance ──> Employee, LeaveType (per year)
Payroll: SalaryStructure ← items → SalaryComponent;  EmployeeSalary → Employee, SalaryStructure
PayrollPeriod → PayrollProcess → PayrollDetail → Payslip (per process)
Workflow: Definition → Steps; Instance → tasks/history; tasks routed via Manager/LevelHR resolution
Recruitment: Candidate → Offer → OnboardingCase → tasks + documentRequirements; OnboardingCase.convertedEmployee → Employee
Performance: PerformanceReview →/← PerformanceGoal (review link), both → Employee
Asset: AssetCategory → Asset → Assignments + Events; currentHolder → Employee
Timesheet: Timesheet → Items (→ EmployeeAssignment, Project, Shift); assignedManager → Employee; payrollConsumedOn/payrollPeriod set by the payroll engine (set-once consumption)
Notification.recipient → Employee (via $user.employeeId row-level rule)
Geo: Geofence → Employee via Eligibility; AttendanceLocationEvent → Employee + Attendance + Geofence (server-written)
AuditLog — standalone, opt-in writes from every service, SystemAdmin-only read
```

### 9.3 Seed data and development test users

- Seed CSVs in [db/data/](../db/data/) include: 10 employees (codes EMP000001–EMP000010), 4 departments, 3 payroll salary structures & components, 3 salary structures, leave types/policies/balances/requests, attendance rows, projects, teams, **4 active workflow definitions + 5 steps** (Sprint 15 added WF-TIMESHEET-STD), onboarding checklist with items. Sprint 16 seeds **2 geofences** (GF0001 Head Office Bengaluru, GF0002 Electronics City Site).
- Development/test users: see the table in [Section 4.3](#43-mock-users-local-development--tests-only). They use mocked basic auth with **empty passwords — valid only in local dev and tests**, never production.

### 9.4 Commands

| Command | Purpose |
|---|---|
| `npm install` | install dependencies |
| `npm run watch` / `npm start` | run the CAP server locally (port 4004) |
| `npm test` | full automated test suite (in-memory DB, profile `[test]`) — currently **197 tests, exit 0** |
| `CDS_ENV=test node --test test/<file>.test.js` | run one suite file |
| `npx cds compile srv --to csn` | validate the whole service model (exit 0 = OK) |
| `npx cds compile db --to hana` | validate the production (HANA) schema |
| `npx cds compile srv/<domain>/<domain>-service.cds --to edmx` | per-service EDMX (multi-service full-model edmx errors by design) |
| `npx cds-serve --port 4005` | start on another port when 4004 is busy |

Environment variables honored: `CDS_ENV=test` (test profile), `PORT` (server), `EMPLOYEE_CONTEXT_TTL_MS` (identity cache TTL).

### 9.5 Troubleshooting

See [Section 11](#11-troubleshooting) for the short list (port conflict, stale db.sqlite, 401/403 in dev, test-hang policy, CDS compile errors).

---

## 10. Testing and known limitations

### 10.1 Automated test suites (current state)

| Suite | File | Tests | Focus |
|---|---|---|---|
| Shared bootstrap | [test/setup.js](../test/setup.js) | — | one `cds.test()` server per file, in-memory DB, no `process.exit()` |
| Sprints 1–11 regression | [test/regression-s1-11.test.js](../test/regression-s1-11.test.js) | 39 | org/employee/project/attendance/leave/payroll/workflow/notification RBAC, self-write guard, payroll lock/unlock, notification privacy |
| Sprint 12 | [test/recruitment.test.js](../test/recruitment.test.js) | 31 | candidate→offer→workflow→approval→send→accept→onboarding→tasks/docs→Complete→ConvertToEmployee idempotency; CTC masking; security |
| Sprint 13 | [test/performance.test.js](../test/performance.test.js) | 42 | review/goal lifecycles, workflow-backed approval, frozen immutability, rating validation, duplicate 409, self-review 400, row-level 404s |
| Sprint 14 | [test/asset.test.js](../test/asset.test.js) | 44 | full asset lifecycle (assign/ack/transfer/return/repair/lost/damaged/retire/dispose), serial uniqueness, blocked PATCHes, row-level security |
| Sprint 15 | [test/timesheet.test.js](../test/timesheet.test.js) | 13 | draft/overnight/duplicate validation, lifecycle + manager scope, PATCH-bypass, payroll single-consumption + freeze, workflow integration, concurrent-approve race, notifications |
| Sprint 16 | [test/geo.test.js](../test/geo.test.js) | 18 | geofence config validation + admin-only actions, distance/boundary, eligibility restriction, bypass paths (WFH/inactive/expired/future-effective/none), check-in/out geofence integration, staleness/malformed, duplicate/retry, privacy scope, history/audit |
| **Total** | 6 suites | **197** | **197 pass / 0 fail / 0 skipped, exit 0** |

Additions during the audit: the `/odata/v4/employee/AuditLogs` visibility (SystemAdmin-only) and the **self-write guard** tests across leave & attendance.

### 10.2 Verified automated coverage highlights

- **Cross-module flows**: leave request creation, payroll lifecycle locking/unlocking, asset full lifecycle, onboarding → employee conversion (idempotent), offer approval, review approval.
- **Security negative tests**: plain employee blocked from reading/creating others' data across all domains (403/404 asserted per case); role-specific grants like `PayrollExecutive cannot read salary structures`, `FinanceManager cannot unlock payroll`.
- **Engine guard integrity**: workflow history immutability, task access control including delegate and self-approval rules.
- **Idempotency**: ConvertToEmployee, MarkAsRead, AcknowledgeAssignment, asset 409 paths.

### 10.3 Implemented but not adequately automated (manual examples only)

- **Sprint 7/8 engine internals per-employee payroll calculation** — only the period lock/unlock lifecycle is automated; walk-through examples live in `test/payroll.http`.
- **Sprint 6 LeaveApprovals direct flow** — the legacy two-level `LeaveApproval` path is documented and works but has no dedicated automated suite (workflow path is covered instead).
- **Employee profile detail validations** (education percentage/CGPA, experience dates, document type rules) — rules exist in handlers, verified manually, not automated.
- **Overtime rules** — create enforced, but cross-role approval flow not scripted in tests.
- **Workflow Reassign / Delegate / Escalate / SendBack / Resubmit** — the actions are covered for the **happy-path** in the offer/review suites for approval; **Delegate and Reassign have implementation but minimal automated test coverage** in the current suites.
- **Notifications for modules other than recruitment/performance/asset (leave/attendance/payroll)** — no `notify()` calls found in those handlers. Not a defect — the `NotificationCategory` enum reserves LEAVE/ATTENDANCE/PAYROLL values for future use — but it means the notification center currently only carries recruitment/performance/asset events.

### 10.4 Known limitations (by design or currently accepted)

1. **`@assert.unique` is not enforced by the CAP SQLite runtime** (documented in comments); handlers fill the gap where it matters (asset serial numbers, employee emails, offer/candidate codes verified in tests). `_(_requires verification if a new entity adds an `@assert.unique` column_)`
2. **`AssetStatus.Returned`** is a legacy enum value kept for compatibility; the handlers never set it (asset lifecycle uses assignment status for "returned" instead).
3. **`EmployeeService.Employees` for DepartmentManager/ProjectManager** uses project-department scope (`assignments.project.department_ID`) — this can grant READ access to employees across a project even when they are not direct reports. Documented in the CDS.
4. **WorkflowTasks list READ for plain Employee** is not filtered by `@restrict`; the engine guards **actions**, and the row-visibility nuance for list queries is documented in `workflow-security.cds` comments (note: not covered by an automated test — *requires verification before exposing a task list UI*).
5. **CTC masking on Offers** masks only `offeredCTC`; other compensation-adjacent fields (if added later) must follow the same pattern.
6. **CAP CAP `req.params[0]` raw-UUID quirk** — handled centrally by `extractKeys` in audit.js and `keysOf`-style helpers in handlers; future code must keep wrapping raw key params.
7. **`readme.md`** still contains the older aspiration list and partial state descriptions; `SETUP.md` is current for setup and testing; sprint docs exist for 12–15. See [docs/](./) links at the bottom of this guide.
8. **Timesheet corrections after payroll consumption** are blocked by design; a payroll adjustment mechanism is a documented gap (see [docs/sprints/SPRINT-15.md](sprints/SPRINT-15.md) §5). The 8h standard day is inherited from attendance/overtime and is a constant, not configurable policy yet.
9. **Geofence evidence is maximal ~11 m precision and client-supplied** — coordinates submitted by clients are inherently spoofable; EWMS records *evidence*, never proof of device authenticity, and claims no anti-spoofing. A retention purge job is deliberately not implemented until an HR/legal retention decision exists. See [docs/sprints/SPRINT-16.md](sprints/SPRINT-16.md) §5.

### 10.5 Warnings requiring investigation

- Add tests for **workflow Delegate / Reassign** role checks before building a Fiori work item UI on top.
- Add tests for **`EmployeeService.Employees` DepartmentManager scope with the project-assignment edge case** (project-based accesses when the assignment is made under a different project).
- The **direct `LeaveApprovals`** path is reachable in parallel with the workflow path; confirm the two cannot contradict each other in a corner case (e.g. both approve different decisions). _(_requires verification_)_

### 10.6 Planned features (from the roadmap, NOT in the repo)

Rostering/scheduling UIs, notification channel **EMAIL** sending, external integrations, anonymous feedback channels, engagement-activity participation, Fiori/UI5 apps, BTP deployment configuration. **Do not document these as implemented anywhere.** (Exit Management was previously planned and is now implemented — see §5.21.)

---

## 11. Troubleshooting

Short list (details in [SETUP.md](../SETUP.md)):

| Symptom | Cause / fix |
|---|---|
| `Cannot find module '@sap/cds'` | run `npm install` |
| Port 4004 busy | stop the old server or `npx cds-serve --port 4005` |
| `401` calling any service | send `Authorization: Basic <username>:` (empty password in dev) |
| `403` everywhere for a mocked user | check the role in `package.json` and the module's `*-security.cds` |
| `db.sqlite` odd / stale | stop the server, delete `db.sqlite`, restart — it re-seeds from CSVs |
| Tests hang | do **not** use `process.exit()` anywhere; re-run `npm test` from a clean shell |
| Multi-service `edmx` compile error | expected — compile per service or use `--to csn` |
| "Multiple errors occurred" instead of a clear message | handlers deliberately fail fast in priority order — check that the guard you care about actually runs first |

---

## 12. Document history

- Written from direct repository inspection (models, services, security CDS, handlers, shared utilities, tests, seed data, package.json) — no behavior was inferred from other docs.
- Companion docs: [SETUP.md](../SETUP.md) (running the project), [readme.md](../readme.md) (high-level overview, partial sprint status), [docs/sprints/SPRINT-12.md](./sprints/SPRINT-12.md), [docs/sprints/SPRINT-13.md](./sprints/SPRINT-13.md), [docs/sprints/SPRINT-14.md](./sprints/SPRINT-14.md), [docs/sprints/SPRINT-15.md](./sprints/SPRINT-15.md), [docs/sprints/SPRINT-15-AUDIT.md](./sprints/SPRINT-15-AUDIT.md), [docs/sprints/SPRINT-16.md](./sprints/SPRINT-16.md), [docs/sprints/SPRINT-17.md](./sprints/SPRINT-17.md), [docs/sprints/SPRINT-18.md](./sprints/SPRINT-18.md), [docs/sprints/SPRINT-19.md](./sprints/SPRINT-19.md), [docs/sprints/SPRINT-20.md](./sprints/SPRINT-20.md), [docs/sprints/SPRINT-21.md](./sprints/SPRINT-21.md), [docs/payroll.md](./payroll.md).
- Sprint 21 (Exit Management) verified against the repository through the exit module files + `test/exit.test.js`; TOC and matrix updated accordingly.
- Sprint 22 (Dashboard & Analytics) and Sprint 23 (Reports & Export) added after the repository was found WITHOUT any Sprint 22 artifacts (see docs/sprints/SPRINT-22-AUDIT.md); full suite at documentation time: 384 tests / 114 suites, all passing, both compiles exit 0.
- Sprint 24 (Background Jobs & Scheduled Processing) added from [srv/jobs/](../srv/jobs) + [SPRINT-24.md](./sprints/SPRINT-24.md); suite at documentation time: 399 tests / 119 suites, all passing, both compiles exit 0.
- Test counts and permission tables reflect the code at documentation time; re-run `npm test` before relying on exact numbers.
