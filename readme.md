# EWMS – Enterprise Workforce Management System

> A modular Enterprise Workforce Management System built using **SAP CAP (Node.js)**, **SAP HANA Cloud**, **SAP Fiori Elements**, and **SAP Business Technology Platform (BTP)**.

---

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

| Layer | Technology |
|--------|------------|
| Backend | SAP CAP (Node.js) |
| Database (Development) | SQLite |
| Database (Production) | SAP HANA Cloud |
| UI | SAP Fiori Elements |
| Platform | SAP Business Technology Platform (BTP) |
| Authentication | XSUAA (Planned) |
| Deployment | Cloud Foundry |
| Testing | REST Client (.http), OData V4 |

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

| Entity | Format |
|---------|---------|
| Company | COMP0001 |
| Business Unit | BU0001 |
| Department | DEP0001 |
| Project | PROJ0001 |
| Team | TEAM0001 |
| Employee | EMP000001 |
| Leave | LV000001 |

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

| Module | Status |
|---------|--------|
| Common | ✅ |
| Organization | ✅ |
| Project | ✅ |
| Team | ✅ |
| Employee | ✅ |
| Employee Profile | ✅ |
| Attendance | ✅ |
| Leave | 🚧 |
| Payroll | ⏳ |
| Performance | ⏳ |
| Assets | ⏳ |
| Recruitment | ⏳ |
| Security | ⏳ |
| Analytics | ⏳ |

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

- Leave Management
- Payroll
- Performance Management
- Asset Management
- Recruitment
- Security
- Notifications
- Reports
- Fiori Applications
- SAP BTP Deployment

---

# Author

Enterprise Workforce Management System

Developed using SAP CAP Framework.