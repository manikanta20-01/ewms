# EWMS – Enterprise Workforce Management System
## Complete Project Documentation

> A modular Enterprise Workforce Management System (HRMS) built on **SAP CAP (Node.js)**, using **SQLite** in development and **SAP HANA Cloud** in production, secured with **XSUAA / SAP IAS** and **role-based, row-level authorization**.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [Modules & Entities](#4-modules--entities)
5. [Security Model & User Roles](#5-security-model--user-roles)
6. [Dev/Mock Users (Login Details)](#6-devmock-users-login-details)
7. [How to Run the Project](#7-how-to-run-the-project)
8. [How to Use From a Frontend](#8-how-to-use-from-a-frontend)
9. [Request & Response Formats (Backend Contract)](#9-request--response-formats-backend-contract)
10. [Frontend Request/Response Examples (per module)](#10-frontend-requestresponse-examples-per-module)
11. [Error Response Format](#11-error-response-format)
12. [Business Rules](#12-business-rules)
13. [Deployment (Production)](#13-deployment-production)
14. [Project Structure](#14-project-structure)
15. [Roadmap](#15-roadmap)

---

## 1. Project Overview

EWMS is a full-stack enterprise HRMS solution that manages an organization's workforce through the entire employee lifecycle — from onboarding, org structure, project/team assignment, attendance and leave, through to payroll processing and payslip generation.

The application is built **module by module** (organized as CAP "sprints"), where each business domain has its own:

- CDS data model (`db/<module>/*.cds`)
- OData service definition (`srv/<module>/<module>-service.cds`)
- Security/authorization rules (`srv/<module>/<module>-security.cds`)
- Business logic handlers (`srv/<module>/handlers/*.js`)
- Sample/seed data (`db/data/*.csv`)
- `.http` test files (`test/*.http`)

| Sprint | Module | Status |
|---|---|---|
| 1 | Common Foundation (types, enums, aspects) | ✅ Completed |
| 2 | Organization | ✅ Completed |
| 3 | Project & Team | ✅ Completed |
| 4 | Employee Core | ✅ Completed |
| 5 | Employee Profile (Bank/Education/Experience/Document/Statutory) | ✅ Completed |
| 6 | Attendance | ✅ Completed |
| 7 | Leave Management | ✅ Completed |
| 8 | Payroll | ✅ Completed |
| 9 | Security & Authorization | ✅ Completed |
| 10 | Workflow & Approval Engine | ⏳ Planned |
| 11 | Notifications | ⏳ Planned |
| 12 | Dashboard & Analytics | ⏳ Planned |
| 13 | Reports & Export | ⏳ Planned |
| 14 | Document Management | ⏳ Planned |
| 15 | Background Jobs | ⏳ Planned |
| 16 | External Integrations | ⏳ Planned |
| 17 | SAP Fiori/UI5 Applications | ⏳ Planned |
| 18 | Production Readiness | ⏳ Planned |

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Backend | SAP CAP (Node.js, `@sap/cds`) |
| Database (Development) | SQLite (`db.sqlite`) |
| Database (Production) | SAP HANA Cloud (HDI container) |
| Authentication (Development) | Mocked users (`cds.requires.auth.kind = "mocked"`) |
| Authentication (Production) | SAP IAS (identity) + XSUAA (authorization) |
| Authorization Model | CDS `@restrict` (role-based + row-level) |
| API Protocol | OData V4 |
| Deployment | Cloud Foundry via MTA (`mta.yaml`) |
| Testing | `.http` REST Client files |

---

## 3. Architecture

```text
Frontend (SAPUI5 / Fiori / React / Postman / any HTTP client)
        │
        │  HTTPS + Basic Auth (dev)  /  Bearer JWT (prod)
        ▼
┌─────────────────────────────────────────────┐
│               CAP Node.js Server             │
│                                               │
│  Middleware:                                 │
│   - resolve-employee-context.js              │
│     (injects user.attr.employeeId /           │
│      departmentId used by row-level rules)   │
│   - login-history.js (audit trail)           │
│                                               │
│  Services (OData V4):                        │
│   OrganizationService  /odata/v4/organization │
│   EmployeeService      /odata/v4/employee     │
│   ProjectService       /odata/v4/project      │
│   TeamService          /odata/v4/team         │
│   AttendanceService    /odata/v4/attendance   │
│   LeaveService         /odata/v4/leave        │
│   PayrollService       /odata/v4/payroll      │
│                                               │
│  Each service entity is protected by an      │
│  @restrict annotation (role + row filter)    │
└─────────────────────────────────────────────┘
        │
        ▼
   Database (SQLite dev / HANA Cloud prod)
```

**Authentication flow (production):**

```text
User → SAP IAS (login) → JWT → XSUAA (scope/role mapping)
     → CAP reads req.user.roles + req.user.attr
     → CDS @restrict evaluates role + row-level "where" clause
     → Request allowed / 403 Forbidden
```

**Authentication flow (development/mocked):** Basic Auth with a username defined in `package.json → cds.requires.auth.users`; no password needed.

---

## 4. Modules & Entities

| Service | Base Path | Entities |
|---|---|---|
| OrganizationService | `/odata/v4/organization` | Companies, BusinessUnits, Departments, Locations, DepartmentHRs |
| EmployeeService | `/odata/v4/employee` | Employees, Designations, Grades, EmployeeAssignments, EmployeeHistory, Banks, Educations, Experiences, Documents, StatutoryDetails |
| ProjectService | `/odata/v4/project` | Projects, ProjectManagers |
| TeamService | `/odata/v4/team` | Teams, TeamManagers |
| AttendanceService | `/odata/v4/attendance` | Attendances, Shifts, ShiftAssignments, WorkSchedules, Holidays, HolidayCalendars, Overtimes |
| LeaveService | `/odata/v4/leave` | LeaveTypes, LeaveRequests, LeavePolicies, LeaveBalances, LeaveApprovals, ApprovalHistories |
| PayrollService | `/odata/v4/payroll` | SalaryComponents, SalaryStructures, SalaryStructureItems, EmployeeSalaries, PayrollPeriods, PayrollProcesses, PayrollDetails, Payslips, PayrollHistories |

**Bound OData Actions** exist only on `PayrollService`:

| Entity | Action | Params | Returns |
|---|---|---|---|
| PayrollPeriods | `ProcessPayroll` | `otRateMultiplier: Decimal(3,2)` | `String` |
| PayrollPeriods | `ApprovePayrollBatch` | — | `String` |
| PayrollPeriods | `LockPayroll` | — | `String` |
| PayrollPeriods | `UnlockPayroll` | — | `String` |
| PayrollProcesses | `RecalculatePayroll` | — | `String` |
| PayrollProcesses | `RejectPayroll` | `reason: String` | `String` |
| Payslips | `PublishPayslip` | — | `String` |

All other modules are pure CRUD; workflow transitions (e.g. approving leave, checking in/out, approving overtime) are done by `PATCH`-ing a status/decision field — there are no bound actions for these.

---

## 5. Security Model & User Roles

Authorization uses CDS `@restrict` with two layers:

1. **Role-based** — which roles can perform which operations (CREATE/READ/UPDATE/DELETE) on an entity.
2. **Row-level** — a `where` clause scoping *which rows* a role can see/touch, using `$user.employeeId` / `$user.departmentId`.

| Role | Purpose | Typical Scope |
|---|---|---|
| `Employee` | Self-service | Own records only (`employee_ID = $user.employeeId`) |
| `DepartmentManager` | Department operations | Records where `department_ID = $user.departmentId` |
| `ProjectManager` | Project management | Assigned projects/teams |
| `HRExecutive` | HR operations | Department-scoped HR data |
| `HRAdmin` | HR administration | Full HR data, most CRUD |
| `FinanceManager` | Payroll approval | Approve/lock/reject payroll |
| `PayrollExecutive` | Payroll processing | Process/recalculate payroll |
| `SystemAdmin` | Full access | Everything, incl. `UnlockPayroll` |

In production, these map to XSUAA scopes/role-collections defined in `xs-security.json` (`EWMS_Employee`, `EWMS_HRAdmin`, `EWMS_DepartmentManager`, etc.), with `employeeId` and `departmentId` carried as **user attributes** on the JWT.

---

## 6. Dev/Mock Users (Login Details)

For local development (`cds watch`), authentication is **mocked** — Basic Auth with the username below and **an empty password**.

| Username | Role | employeeId (attr) | departmentId (attr) |
|---|---|---|---|
| `empjohn` | Employee | `10000000-0000-0000-0000-000000000001` | `11111111-dddd-1111-dddd-111111111111` |
| `mgrdept` | DepartmentManager | `10000000-0000-0000-0000-000000000004` | `11111111-dddd-1111-dddd-111111111111` |
| `hrperson` | HRAdmin | `10000000-0000-0000-0000-000000000002` | `11111111-dddd-1111-dddd-111111111111` |
| `payexec` | PayrollExecutive | `10000000-0000-0000-0000-000000000006` | `11111111-dddd-1111-dddd-111111111111` |
| `finmgr`* | FinanceManager | — | — |
| `mgrproj`* | ProjectManager | — | — |
| `sysadmin`* | SystemAdmin | — | — |

\* `finmgr`, `mgrproj`, and `sysadmin` are used throughout `test/*.http` files but are not present in the current `package.json` mocked-users block — add them there (same shape as the rows above) if you need to exercise Finance/Project/SystemAdmin flows locally.

**Example login header (dev):**
```
Authorization: Basic aHJwZXJzb246
```
(Basic auth of `hrperson:` with empty password — most HTTP clients build this for you from `Authorization: Basic hrperson:`.)

**Production login:** handled entirely by SAP IAS (redirect-based OIDC/SAML login) — the frontend never constructs Basic Auth headers in production; it receives a session/JWT after IAS login and XSUAA token exchange.

---

## 7. How to Run the Project

```bash
# 1. Install dependencies
npm install

# 2. Run locally (SQLite, mocked auth, hot reload)
cds watch

# 3. (optional) Compile the CDS model
cds compile db/schema.cds

# Server starts at:
http://localhost:4004

# OData root:
http://localhost:4004/odata/v4

# Service metadata example:
http://localhost:4004/odata/v4/employee/$metadata
```

---

## 8. How to Use From a Frontend

### 8.1 Base URL

```
Development : http://localhost:4004/odata/v4/<service>
Production  : https://<your-app-route>.cfapps.<region>.hana.ondemand.com/odata/v4/<service>
```

### 8.2 Authentication headers

**Development (mocked):**
```http
GET /odata/v4/employee/Employees HTTP/1.1
Authorization: Basic hrperson:
Accept: application/json
```
Any HTTP client can send this — e.g. in `fetch`:
```js
fetch("http://localhost:4004/odata/v4/employee/Employees", {
  headers: {
    "Authorization": "Basic " + btoa("hrperson:"),
    "Accept": "application/json"
  }
});
```

**Production (XSUAA/IAS):**
```js
fetch("https://<route>/odata/v4/employee/Employees", {
  headers: {
    "Authorization": "Bearer " + accessToken,   // obtained via IAS login + XSUAA token exchange
    "Accept": "application/json"
  }
});
```
A typical SAPUI5/Fiori app doesn't build this manually — the CAP-approuter / XSUAA session handles token attachment automatically once the user has logged in via IAS.

### 8.3 Standard OData query options supported

| Option | Purpose | Example |
|---|---|---|
| `$filter` | Filter rows | `?$filter=status eq 'Active'` |
| `$expand` | Include related entities | `?$expand=employee,leaveType` |
| `$select` | Return only specific fields | `?$select=ID,firstName,lastName` |
| `$top` / `$skip` | Pagination | `?$top=20&$skip=40` |
| `$orderby` | Sorting | `?$orderby=createdAt desc` |
| `$count` | Include total count | `?$count=true` |

### 8.4 Recommended frontend flow

1. Log in (mocked Basic Auth in dev, IAS/XSUAA in prod) → obtain credentials/token.
2. Call `GET /odata/v4/<service>/$metadata` once to know entity shapes (optional — useful for OData-aware UI frameworks like SAPUI5).
3. Use `GET` for lists/detail views, `POST` to create, `PATCH` to update (never `PUT` for partial updates), `DELETE` to remove.
4. For Payroll workflow steps, call the **bound action** URL (see §10.7) instead of PATCH.
5. Always check HTTP status: `200`/`201` success, `403` forbidden (role/row-level denied), `400` validation error, `404` not found.

---

## 9. Request & Response Formats (Backend Contract)

### 9.1 Common request headers

| Header | Required | Notes |
|---|---|---|
| `Authorization` | Yes | Basic (dev) or Bearer JWT (prod) |
| `Content-Type` | For POST/PATCH | `application/json` |
| `Accept` | Recommended | `application/json` |

### 9.2 Standard entity response shape (GET single/list)

```json
{
  "@odata.context": "$metadata#Employees",
  "value": [
    {
      "ID": "10000000-0000-0000-0000-000000000001",
      "employeeCode": "EMP000001",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "status": "Active",
      "createdAt": "2026-01-01T09:00:00Z",
      "createdBy": "hrperson",
      "modifiedAt": "2026-01-01T09:00:00Z",
      "modifiedBy": "hrperson"
    }
  ]
}
```

Every entity automatically includes CAP's `managed` aspect fields: `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` (read-only, system-set).

### 9.3 Create (POST) request/response

**Request:**
```http
POST /odata/v4/leave/LeaveRequests
Authorization: Basic empjohn:
Content-Type: application/json

{
  "employee_ID": "10000000-0000-0000-0000-000000000001",
  "leaveType_ID": "7a000000-0000-0000-0000-000000000001",
  "fromDate": "2026-09-20",
  "toDate": "2026-09-21",
  "totalDays": 2.00,
  "reason": "Personal work",
  "status": "Draft"
}
```

**Response (201 Created):**
```json
{
  "@odata.context": "$metadata#LeaveRequests/$entity",
  "ID": "7d000000-0000-0000-0000-000000000099",
  "leaveNumber": "LV000099",
  "employee_ID": "10000000-0000-0000-0000-000000000001",
  "leaveType_ID": "7a000000-0000-0000-0000-000000000001",
  "fromDate": "2026-09-20",
  "toDate": "2026-09-21",
  "totalDays": "2.00",
  "status": "Draft",
  "appliedOn": "2026-08-02T10:00:00Z",
  "createdAt": "2026-08-02T10:00:00Z",
  "createdBy": "empjohn"
}
```

### 9.4 Update (PATCH) request/response

**Request:**
```http
PATCH /odata/v4/leave/LeaveApprovals('7e000000-0000-0000-0000-000000000002')
Authorization: Basic mgrdept:
Content-Type: application/json

{
  "decision": "Approved",
  "decisionDate": "2026-08-02T12:00:00Z",
  "remarks": "Approved — coverage confirmed"
}
```

**Response (200 OK):** returns the full updated entity (same shape as GET single).

### 9.5 Delete (DELETE) request/response

```http
DELETE /odata/v4/organization/Locations('id')
Authorization: Basic hrperson:
```
**Response:** `204 No Content` (empty body) on success. Many entities disallow physical delete by business rule (e.g. Bank, Document) — these return a `400`/`403` with a validation message instead.

### 9.6 Bound Action call request/response (Payroll only)

```http
POST /odata/v4/payroll/PayrollPeriods('8e000000-0000-0000-0000-000000000002')/PayrollService.ProcessPayroll
Authorization: Basic payexec:
Content-Type: application/json

{
  "otRateMultiplier": 1.50
}
```

**Response (200 OK):**
```json
{
  "@odata.context": "$metadata#Edm.String",
  "value": "Payroll processed for period PAY202607 — 42 employees calculated."
}
```

---

## 10. Frontend Request/Response Examples (per module)

### 10.1 Organization
```http
GET /odata/v4/organization/Departments?$expand=businessUnit,location
Authorization: Basic hrperson:
```
```json
{
  "value": [
    {
      "ID": "44444444-dddd-4444-dddd-444444444444",
      "departmentCode": "DEP0001",
      "departmentName": "Engineering",
      "status": "Active",
      "businessUnit": { "ID": "...", "businessUnitName": "Technology" },
      "location": { "ID": "...", "locationName": "Bengaluru HQ" }
    }
  ]
}
```

### 10.2 Employee (self-service view)
```http
GET /odata/v4/employee/Employees?$expand=banks,educations,experiences,documents,statutoryDetails
Authorization: Basic empjohn:
```
Row-level rule restricts this to the logged-in employee's own record only (`ID = $user.employeeId`).

### 10.3 Attendance (check-in)
```http
POST /odata/v4/attendance/Attendances
Authorization: Basic empjohn:
Content-Type: application/json

{
  "employee_ID": "10000000-0000-0000-0000-000000000001",
  "attendanceDate": "2026-08-02",
  "shift_ID": "20000000-0000-0000-0000-000000000001",
  "checkIn": "09:00:00",
  "attendanceStatus": "Present"
}
```
Response: `201 Created` with the full Attendance record including generated `ID`.

### 10.4 Leave (apply + approve)
```http
POST /odata/v4/leave/LeaveRequests           → 201 (employee applies)
PATCH /odata/v4/leave/LeaveApprovals('id')   → 200 (manager approves via decision field)
```

### 10.5 Payroll (view own payslip)
```http
GET /odata/v4/payroll/Payslips?$filter=payrollProcess/employee_ID eq '10000000-0000-0000-0000-000000000001'
Authorization: Basic empjohn:
```
Row-level rule: employees can only read payslips where `payrollProcess.employee_ID = $user.employeeId`, and only after `publishedOn` is set (via `PublishPayslip`).

### 10.6 Team / Project
```http
GET /odata/v4/project/Projects?$expand=department
GET /odata/v4/team/Teams?$filter=project_ID eq '11111111-ffff-1111-ffff-111111111111'
```

### 10.7 Payroll Action call (frontend button → backend action)
A "Process Payroll" button in the UI should call:
```js
async function processPayroll(periodId, otRate) {
  const res = await fetch(
    `${baseUrl}/PayrollPeriods('${periodId}')/PayrollService.ProcessPayroll`,
    {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ otRateMultiplier: otRate })
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const { value } = await res.json();   // status message string
  return value;
}
```

---

## 11. Error Response Format

CAP returns standard OData error envelopes:

```json
{
  "error": {
    "code": "403",
    "message": "Forbidden",
    "target": "LeaveApprovals",
    "details": []
  }
}
```

| HTTP Status | Meaning | Typical Cause |
|---|---|---|
| `400 Bad Request` | Validation failure | Business rule violated (e.g. negative salary, duplicate code) |
| `401 Unauthorized` | Not authenticated | Missing/invalid credentials or token |
| `403 Forbidden` | Not authorized | Role or row-level `@restrict` rule denied the operation |
| `404 Not Found` | Entity/record not found | Bad ID or record scoped out by row-level filter |
| `409 Conflict` | Uniqueness violation | e.g. duplicate `leaveCode`, `componentCode` |

The frontend should always branch on status code first, then read `error.message` for a user-facing string.

---

## 12. Business Rules (Selected)

- **Employee**: employee code auto-generated; email must be unique.
- **Bank**: multiple accounts allowed; only one active payroll account; no physical delete.
- **Education**: passing year cannot be in the future; percentage 0–100; CGPA 0–10.
- **Experience**: joining date must precede relieving date; salary cannot be negative.
- **Document**: only HR can verify; employees cannot self-verify; no physical delete.
- **Statutory Detail**: one record per employee; PAN/Aadhaar/PF/UAN format-validated.
- **Payroll**: a locked `PayrollPeriod` blocks recalculation until `UnlockPayroll` (SystemAdmin only) is called; `Payslips` are only employee-visible after `PublishPayslip`.

---

## 13. Deployment (Production)

Deployment target: **SAP BTP, Cloud Foundry**, defined in `mta.yaml`:

| Resource | Type | Purpose |
|---|---|---|
| `ewms-srv` | Node.js module | The CAP application itself |
| `ewms-db` | `hdi-container` (HANA) | Production database |
| `ewms-xsuaa` | XSUAA managed service | Role/scope-based authorization (`xs-security.json`) |
| `ewms-ias` | Identity managed service | SAP IAS login/authentication |

Build & deploy:
```bash
mbt build
cf deploy mta_archives/ewms_1.0.0.mtar
```

---

## 14. Project Structure

```
ewms/
├── db/
│   ├── common/            # shared types, enums, aspects, validations
│   ├── organization/
│   ├── project/
│   ├── team/
│   ├── employee/
│   ├── attendance/
│   ├── leave/
│   ├── payroll/
│   └── data/               # CSV seed data
│
├── srv/
│   ├── common/
│   │   ├── auth/            # authorization.js, roles.js, role-groups.js
│   │   └── utils/           # audit, validation, code-generator, etc.
│   ├── middleware/          # resolve-employee-context.js, login-history.js
│   ├── organization/        # service.cds, security.cds, service.js, handlers/
│   ├── employee/
│   ├── project/
│   ├── team/
│   ├── attendance/
│   ├── leave/
│   ├── payroll/
│   ├── security/            # auth-annotations.cds
│   ├── server.js
│   └── services.cds          # aggregates all service + security imports
│
├── test/                     # .http REST Client test suites
├── xs-security.json          # XSUAA role/scope definitions
├── mta.yaml                  # Cloud Foundry deployment descriptor
└── package.json               # cds config, mocked dev users
```

---

## 15. Roadmap

- Workflow & multi-level Approval Engine
- Notifications (email/push)
- Dashboard & Analytics
- Reports & Export
- Document Management (proper file storage, not just metadata)
- Background Jobs (scheduled payroll runs, reminders)
- External Integrations (banking, statutory filing)
- SAP Fiori/UI5 reference frontend
- Full production hardening

---

*Enterprise Workforce Management System — built on the SAP CAP framework.*
