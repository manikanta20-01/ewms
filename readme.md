# EWMS – Enterprise Workforce Management System

> A modular Enterprise Workforce Management System built using **SAP CAP (Node.js)**, **SAP HANA Cloud**, **SAP Fiori Elements**, and **SAP Business Technology Platform (BTP)**.

📚 **Full system documentation:** [docs/EWMS_COMPLETE_SYSTEM_GUIDE.md](docs/EWMS_COMPLETE_SYSTEM_GUIDE.md) — every module, permission matrix, workflows, shared services, configuration, and testing.

---
Based on the project archive you uploaded, your **Sprint 9 – Security & Authorization** is essentially complete from an implementation perspective. I found the expected security artifacts, including:

* Central authorization utilities
* Security annotations for each module
* Module-specific security files
* `xs-security.json`
* Security HTTP tests
* Common authentication helpers
* Role definitions and role groups 

---






















# Sprint 9 – Security & Authorization Documentation

## Status

**Sprint:** 9

**Module:** Enterprise Security & Authorization

**Status:** ✅ Completed

**Technology**

* SAP CAP
* CDS Authorization (`@restrict`)
* XSUAA
* SAP IAS (Production Authentication)
* JWT Authentication
* Role-Based Access Control (RBAC)
* Row-Level Security

---

# Objective

Implement enterprise-grade authentication and authorization for the EWMS application while keeping authentication separated from business logic.

The security module ensures:

* Secure authentication
* Role-based authorization
* Row-level data security
* Action-level authorization
* Audit logging
* Production-ready XSUAA integration

---

# Architecture

```text
User
    │
    ▼
SAP IAS / XSUAA
    │
JWT Token
    │
    ▼
CAP Authentication
    │
    ▼
Employee Context Resolver
    │
    ▼
req.user
    │
    ▼
CDS @restrict
    │
    ▼
Business Services
```

---

# Security Components

## Authentication

Development

* Mock Users
* Basic Authentication

Production

* SAP IAS
* SAP XSUAA
* JWT

Passwords are **never stored or validated inside CAP**.

---

## Authorization

Implemented using:

* CDS `@restrict`
* CAP `req.user`
* Role checks
* Row-level filters

---

## Roles

| Role              | Purpose               |
| ----------------- | --------------------- |
| Employee          | Self-service          |
| DepartmentManager | Department operations |
| ProjectManager    | Project management    |
| HRExecutive       | HR operations         |
| HRAdmin           | HR administration     |
| FinanceManager    | Payroll approval      |
| PayrollExecutive  | Payroll processing    |
| SystemAdmin       | Full access           |

---

# Security Layers

## Layer 1

Authentication

Responsible for:

* Login
* JWT
* Identity

---

## Layer 2

Authorization

Responsible for

* CRUD permissions
* Action permissions

---

## Layer 3

Row-Level Security

Responsible for

* Own Employee
* Own Attendance
* Own Leave
* Own Payslips

Managers

↓

Department Employees

HR

↓

All Employees

---

## Layer 4

Audit

Tracks

* User
* Action
* Entity
* Old Value
* New Value
* Timestamp

---

# Protected Modules

## Organization

Protected

* Companies
* Business Units
* Departments
* Locations
* Department HR

---

## Employee

Protected

* Employees
* Banks
* Documents
* Education
* Experience
* Statutory Details

---

## Team

Protected

* Teams
* Team Managers

---

## Project

Protected

* Projects
* Project Managers

---

## Attendance

Protected

* Attendance
* Overtime
* Shift
* Holiday
* Work Schedule

---

## Leave

Protected

* Leave Requests
* Leave Approvals
* Leave Balances
* Leave Types
* Leave Policies

---

## Payroll

Protected

* Payroll Period
* Payroll Process
* Employee Salary
* Payslip
* Payroll History
* Payroll Detail
* Salary Components
* Salary Structures

---

# Payroll Action Security

| Action              | Role             |
| ------------------- | ---------------- |
| ProcessPayroll      | PayrollExecutive |
| ApprovePayrollBatch | FinanceManager   |
| LockPayroll         | FinanceManager   |
| UnlockPayroll       | SystemAdmin      |
| RecalculatePayroll  | PayrollExecutive |
| RejectPayroll       | FinanceManager   |
| PublishPayslip      | HRAdmin          |

---

# Row-Level Security

Employee

Can access

* Own profile
* Own attendance
* Own leave
* Own payslips
* Own bank
* Own documents

Cannot access

* Other employees' records

Department Manager

Can access

* Department employees only

HR

Can access

* All employee records

Finance

Can access

* Payroll data only

---

# Audit Logging

The system records:

* Employee updates
* Payroll processing
* Leave approvals
* Document verification
* Administrative changes

Sensitive fields are excluded from audit records.

---

# Development Authentication

Uses mocked users for testing.

Examples:

* Employee
* HR Admin
* Payroll Executive
* Finance Manager
* System Admin

---

# Production Authentication

Uses

```text
SAP IAS
        │
        ▼
SAP XSUAA
        │
        ▼
JWT
        │
        ▼
CAP
```

Employee information is resolved dynamically after authentication.

---

# Security Testing

Completed

* Employee own profile
* Employee unauthorized access
* Payroll approval permissions
* Finance approval
* System Administrator access

---

# Sprint Deliverables

* ✅ Authentication configuration
* ✅ XSUAA configuration
* ✅ IAS integration design
* ✅ JWT-based authentication
* ✅ Role-Based Access Control
* ✅ Row-Level Security
* ✅ Action-Level Security
* ✅ Authorization utilities
* ✅ Audit logging
* ✅ Security test cases
* ✅ Production deployment configuration

---

# Future Enhancements

These are intentionally outside Sprint 9:

* Multi-Factor Authentication (configured in IAS)
* Password policies (configured in IAS)
* Single Sign-On
* Conditional Access
* Identity Federation
* External Identity Providers
* Security monitoring and alerting

---

# Sprint 9 Completion Summary

| Area                 | Status |
| -------------------- | ------ |
| Authentication       | ✅      |
| Authorization        | ✅      |
| RBAC                 | ✅      |
| Row-Level Security   | ✅      |
| Action Security      | ✅      |
| Audit Logging        | ✅      |
| Mock Authentication  | ✅      |
| XSUAA Configuration  | ✅      |
| IAS Integration      | ✅      |
| Security Testing     | ✅      |
| Production Readiness | ✅      |

## Overall Assessment

**Sprint 9 is complete and production-oriented.** It establishes a solid security foundation using SAP CAP authorization, XSUAA/IAS authentication, role-based access control, row-level security, and audit logging. The remaining roadmap can now focus on business capabilities (workflow, notifications, reporting, etc.) rather than revisiting core security.



























---

Sprint 1 Foundation ✅
Sprint 2 Organization ✅
Sprint 3 Project & Team ✅
Sprint 4 Employee Core ✅
Sprint 5 Employee Details ✅
Sprint 6 Attendance ✅
Sprint 7 Leave ✅
Sprint 8 Payroll ✅
Sprint 9 Security & Authorization ⏳

---

Sprint 10 Workflow & Approval Engine
Sprint 11 Notifications
Sprint 12 Dashboard & Analytics
Sprint 13 Reports & Export
Sprint 14 Document Management
Sprint 15 Background Jobs
Sprint 16 External Integrations
Sprint 17 SAP Fiori/UI5 Applications
Sprint 18 Production Readiness

# Overview

EWMS is a full-stack enterprise HRMS solution designed to manage an organization's workforce throughout the employee lifecycle.

The application follows a modular architecture where each business domain is developed independently with its own:

- CDS Model
- Service Layer
- Business Logic (Handlers)
- Sample Data
- Test APIs

The project is developed sprint-by-sprint to ensure each module is complete and fully tested before moving to the next.

---

# Technology Stack

| Layer                  | Technology                             |
| ---------------------- | -------------------------------------- |
| Backend                | SAP CAP (Node.js)                      |
| Database (Development) | SQLite                                 |
| Database (Production)  | SAP HANA Cloud                         |
| UI                     | SAP Fiori Elements                     |
| Platform               | SAP Business Technology Platform (BTP) |
| Authentication         | XSUAA (Planned)                        |
| Deployment             | Cloud Foundry                          |
| Testing                | REST Client (.http), OData V4          |

---

# Project Structure

```
ewms/

├── app/
│
├── db/
│   ├── common/
│   ├── organization/
│   ├── project/
│   ├── team/
│   ├── employee/
│   ├── attendance/
│   ├── leave/
│   └── data/
│
├── srv/
│   ├── handlers/
│   ├── organization-service.cds
│   ├── project-service.cds
│   ├── team-service.cds
│   ├── employee-service.cds
│   └── attendance-service.cds
│
├── test/
│   ├── organization.http
│   ├── project.http
│   ├── team.http
│   ├── employee.http
│   └── attendance.http
│
├── package.json
└── README.md
```

---

# Development Principles

- UUID as Primary Key
- Auto-generated Business Codes
- CDS Associations instead of manual foreign keys
- Business logic implemented in handlers
- Managed entities (`createdAt`, `createdBy`, `modifiedAt`, `modifiedBy`)
- Soft delete preferred over physical delete
- Module-based architecture

---

# Business Code Format

| Entity        | Format    |
| ------------- | --------- |
| Company       | COMP0001  |
| Business Unit | BU0001    |
| Department    | DEP0001   |
| Project       | PROJ0001  |
| Team          | TEAM0001  |
| Employee      | EMP000001 |
| Leave         | LV000001  |

---

# Implemented Modules

## Sprint 1 – Common Foundation

- Common Types
- Enumerations
- Aspects
- Constants

Status

✅ Completed

---

## Sprint 2 – Organization

Entities

- Company
- Business Unit
- Location
- Department
- Department HR

Features

- Auto Company Code
- Auto Business Unit Code
- Auto Department Code
- Duplicate Validation
- CRUD Operations

Status

✅ Completed

---

## Sprint 3 – Project & Team

Entities

- Project
- Project Manager
- Team
- Team Manager

Features

- Auto Project Code
- Auto Team Code
- Validation
- CRUD

Status

✅ Completed

---

## Sprint 4 – Employee Core

Entities

- Employee
- Designation
- Grade
- Employee Assignment
- Employee History

Features

- Employee Code Generation
- Email Validation
- Assignment Validation

Status

✅ Completed

---

## Sprint 5 – Employee Profile

Entities

- Bank
- Education
- Experience
- Document
- Statutory Detail

Features

### Employee

- Employee Master
- Address
- Family Details
- Emergency Contact

### Bank

- Multiple Accounts
- Payroll Account
- Duplicate Account Validation
- No Physical Delete

### Education

- Qualification Validation
- Percentage Validation
- CGPA Validation

### Experience

- Date Validation
- Salary Validation
- Duplicate Check

### Document

- Document Upload Metadata
- HR Verification
- Expiry Validation

### Statutory Detail

- PAN Validation
- Aadhaar Validation
- PF
- UAN
- ESI
- Passport

Status

✅ Completed

---

## Sprint 6 – Attendance

Entities

- Attendance
- Shift
- Shift Assignment
- Holiday
- Holiday Calendar
- Work Schedule
- Overtime

Features

- Attendance Recording
- Shift Management
- Holiday Management
- Overtime

Status

✅ Completed

---

## Sprint 7 – Leave Management

Status

🚧 In Progress

---

# Current Modules

| Module           | Status |
| ---------------- | ------ |
| Common           | ✅     |
| Organization     | ✅     |
| Project          | ✅     |
| Team             | ✅     |
| Employee         | ✅     |
| Employee Profile | ✅     |
| Attendance       | ✅     |
| Leave            | 🚧     |
| Payroll          | ⏳     |
| Security         | ⏳     |
| Analytics        | ⏳     |

---

# Business Rules

## Employee

- Employee Code generated automatically
- Email must be unique
- Employee cannot exist without mandatory details

---

## Bank

- Multiple accounts allowed
- Only one payroll account
- Old payroll account becomes inactive
- Physical delete not allowed

---

## Education

- Future passing year not allowed
- Percentage between 0–100
- CGPA between 0–10

---

## Experience

- Joining date before relieving date
- Salary cannot be negative

---

## Document

- HR verifies documents
- Employee cannot verify documents
- Large files rejected
- Physical delete not allowed

---

## Statutory Detail

- One record per employee
- PAN validation
- Aadhaar validation
- PF/UAN validation

---

# Testing

API testing is maintained using `.http` files.

```
test/

organization.http

project.http

team.http

employee.http

attendance.http
```

Each module includes:

- GET
- POST
- PATCH
- DELETE
- Validation Tests

---

# Running the Project

Install dependencies

```bash
npm install
```

Run locally

```bash
cds watch
```

Compile CDS

```bash
cds compile db/schema.cds
```

Open

```
http://localhost:4004
```

OData

```
http://localhost:4004/odata/v4
```

---

# Future Roadmap

- Performance Management
- Asset Management
- Reports
- Fiori Applications
- SAP BTP Deployment

---

# Sprint 12 – Offer Letter + Onboarding + Employee Conversion

**Status:** ✅ Completed

Sprint 12 adds the hiring journey to EWMS, built entirely on the
existing building blocks (Employee Core, generic Workflow Engine,
Sprint 9 authorization, shared Audit, Notifications as an extension
point only):

- **Offer letter lifecycle** – `Draft → PendingApproval → Approved →
  Sent → Accepted`, plus `Rejected`, `Withdrawn`, `Expired`. Invalid
  transitions are blocked, accepted offers are frozen, and direct
  PATCH requests can never change the status.
- **Workflow approval** – `SubmitForApproval` starts the seeded
  definition `WF-OFFER-STD` in the EXISTING workflow engine; the task
  approval callback syncs the offer status. No second workflow engine.
- **Compensation protection** – offers are visible to HR/Finance/
  SystemAdmin; the reporting manager sees their offers with the
  offered CTC masked. Plain employees have no access at all.
- **Onboarding** – accepting a sent offer automatically creates an
  onboarding case with tasks seeded from the reusable checklist
  templates and per-case document requirements
  (`Required/Submitted/Verified/Rejected/Waived`).
  `CompleteOnboarding` blocks while mandatory work is open.
- **Employee conversion** – `ConvertToEmployee` (HRAdmin/SystemAdmin
  only, declarative `@restrict`) creates the employee + active
  assignment in the EXISTING Employee Core and is **idempotent**:
  repeat calls link the existing employee and never create duplicates.
  Audit rows are written through the shared audit helper.

Full details: `docs/sprints/SPRINT-12.md`.
Setup and test instructions: `SETUP.md`.
Automated tests: `npm test` (`test/recruitment.test.js`, 31 tests,
natural process exit). Manual API examples: `test/recruitment.http`.

---

# Sprint 13 – Performance Management

**Status:** ✅ Completed

Sprint 13 adds performance reviews and performance goals, reusing the
Employee Core, the generic Workflow Engine, the shared Notification
core, the shared Audit helper and the Sprint 9 role model:

- **Performance reviews** – `Draft → PendingReview → InReview →
  Submitted → Approved → Completed`, with `Cancelled` as a side exit
  from every non-final state. Status can only change through the
  bound actions – direct PATCH manipulation is blocked, frozen
  (Completed/Approved/Cancelled) reviews are immutable, and the
  overall rating must come from the controlled 1–5 scale
  (`Unsatisfactory … Outstanding`).
- **Workflow approval** – `SubmitReview` starts the seeded definition
  `WF-REVIEW-STD` in the EXISTING Sprint 10 engine; the LevelHR
  approver's task decision is synced back by business callbacks
  (Approved → Approved, Rejected → back to Draft). No new workflow
  engine.
- **Performance goals** – `Draft → Active → Completed (+ Cancelled)`
  with weight validation (0 < weight ≤ 100), sane due dates, and an
  optional link to the review that evaluates them (no goal data is
  duplicated into the review).
- **Sensitive-data protection** – row-level `@restrict`: an employee
  sees only their own reviews/goals, the reviewer only their assigned
  reviews, the goal assignee only their goals, and HR everything.
  A colleague's record returns 404 to an unauthorized reader.
- **Notifications & audit** – review assignment/approval/completion
  and goal activation notify the right person via the shared
  `notify()` core (category PERFORMANCE); every lifecycle action
  writes audit rows through the shared audit helper.

Full details: `docs/sprints/SPRINT-13.md`.
Automated tests: `npm test` (now 73 tests incl. 42 in
`test/performance.test.js`, natural process exit, code 0).

---

# Sprint 14 – Asset Management

**Status:** ✅ Completed

Sprint 14 adds complete asset lifecycle management, built on the
existing Employee Core, Sprint 9 security, shared Notification core
and shared Audit helper:

- **Asset master + categories** – maintainable `AssetCategory` rows
  (no hard-coded categories) and `Asset` records with unique auto
  tags (AST…), serial numbers, procurement/warranty data and a
  controlled condition scale (`New/Good/Fair/Damaged/Critical`).
- **Assignment history preserved** – custody is a set of
  `AssetAssignment` rows (Active → Returned), never an overwritten
  employee field. `transferAsset` closes the old row and opens a new
  one; `returnAsset` records the actual return date and return
  condition (Damaged/Critical returns route the asset to repair).
- **Controlled lifecycle** – `Available → Assigned → (return) →
  Available/InRepair`, with role-restricted actions for repair,
  lost, damaged, inspection (condition + outcome), retirement and
  disposal. Direct PATCH can never move status/condition/holder;
  disposed assets are immutable; retried actions fail with clear
  409/400 instead of duplicating custody records.
- **Full history** – every event (assigned, transferred, returned,
  inspected, repaired, lost, retired, disposed) is appended to
  `AssetEvent`, so the complete story of an asset is always
  reconstructable. Designed so Sprint 21 (Exit Management) can query
  an employee's outstanding and returned assets directly.
- **Security** – row-level `@restrict`: employees see only assets
  they hold and their own assignments; managers see assignments they
  created; HR/asset admins see and manage everything; all lifecycle
  actions are HR/asset-admin only.
- **Notifications & audit** – assignment/transfer/return/lost events
  notify the right person via the shared `notify()` core (category
  ASSET); every action writes audit rows through the shared helper.

Full details: `docs/sprints/SPRINT-14.md`.
Automated tests: `npm test` (now 117 tests incl. 44 in
`test/asset.test.js`, natural process exit, code 0).

---

# Author

Enterprise Workforce Management System

Developed using SAP CAP Framework.
