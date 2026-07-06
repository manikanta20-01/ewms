# Getting Started

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.


========================================================

Based on your architecture (Organization → Project → Team → Employee → HR → Payroll → Performance → Assets → Recruitment → Security), below is a complete roadmap you can copy into a new chat so it has the full context.

README.md
# EWMS - Enterprise Workforce Management System

## Overview

EWMS (Enterprise Workforce Management System) is a complete enterprise-grade HRMS and Workforce Management application developed using SAP CAP (Cloud Application Programming Model), SAP HANA Cloud, SAP Fiori Elements, and SAP BTP.

The application manages an organization's complete employee lifecycle from company setup to recruitment, project allocation, attendance, leave management, payroll, performance, assets, security, notifications, and reporting.

---

# Technology Stack

Backend
- SAP CAP (Node.js)
- CDS Modeling
- SQLite (Development)
- SAP HANA Cloud (Production)

Frontend
- SAP Fiori Elements
- SAPUI5

Platform
- SAP Business Technology Platform (BTP)

Authentication
- XSUAA
- Role Collections

Development
- SAP Business Application Studio

Version Control
- Git
- GitHub

---

# Architecture

Organization
    ↓
Business Unit
    ↓
Location
    ↓
Department
    ↓
Project
    ↓
Team
    ↓
Employee

Everything revolves around Employee.

---

# Project Modules

1. Common Module
2. Organization Module
3. Project Module
4. Team Module
5. Employee Module
6. Employee Profile Module
7. HR Module
8. Leave Approval Workflow
9. Payroll Module
10. Performance Module
11. Assets Module
12. Recruitment Module
13. Security Module
14. Dashboard & Analytics
15. Notifications
16. Audit Logs

---

# Leave Workflow

Employee

↓

Team Manager

↓

Project Manager

↓

Department HR

↓

Approved / Rejected

---

# Employee Flow

Company

↓

Business Unit

↓

Location

↓

Department

↓

Project

↓

Team

↓

Employee

---

# Features

✔ Dynamic Organization Creation

✔ Dynamic Departments

✔ Dynamic Projects

✔ Dynamic Teams

✔ Dynamic Employee Assignment

✔ Multi-Level Leave Approval

✔ Attendance

✔ Payroll

✔ Performance

✔ Recruitment

✔ Asset Management

✔ Role Based Access

✔ Notifications

✔ Audit Logs

✔ Dashboard

---

# Development Methodology

The project is developed Sprint-by-Sprint.

Every Sprint contains

• Database Design

• CDS Models

• Associations

• Services

• Handlers

• Validations

• Auto Code Generation

• Sample Data

• Fiori Testing

• REST API Testing

• Documentation

---

# Naming Convention

Primary Key

ID (UUID)

Business Codes

COMP0001
BU0001
LOC0001
DEP0001
PROJ0001
TEAM0001
EMP000001

Audit Fields

createdAt
createdBy
modifiedAt
modifiedBy

Status Fields

Active
Inactive
Closed

---

# Folder Structure

db/

common/

organization/

project/

team/

employee/

profile/

hr/

payroll/

performance/

assets/

recruitment/

security/

srv/

handlers/

services/

utils/

db/data/

app/

README.md

---

Current Status

Sprint 1
COMPLETE DEVELOPMENT ROADMAP
Sprint 1
Common Foundation

Goal

Prepare reusable framework.

Modules

Common

Develop

types.cds

enums.cds

constants.cds

aspects.cds

validations.cds

Features

Generic Types

Enums

Audit

Validation Messages

Business Codes

Constants

Deliverables

Clean Foundation
Sprint 2
Organization Module

Entities

Company

Business Unit

Location

Department

Department HR

Features

Dynamic Company

Dynamic Business Unit

Dynamic Location

Dynamic Department

Department HR Mapping

Auto Codes

CRUD

Validation

Workflow

Company

↓

Business Unit

↓

Location

↓

Department
Sprint 3
Project Module

Entities

Project

Project Manager

Project History

Features

Department Projects

Project Assignment

Project Manager

Project Lifecycle

Status

Auto Codes

Workflow

Department

↓

Project
Sprint 4
Team Module

Entities

Team

Team Manager

Team History

Features

Create Team

Assign Team Manager

Project Teams

Transfer Team

Deactivate Team

Workflow

Project

↓

Team
Sprint 5
Employee Module

Entities

Employee

Employee History

Employment Type

Designation

Grade

Features

Employee Registration

Employee Code

Assign Team

Assign Manager

Transfer Employee

Deactivate Employee

Workflow

Team

↓

Employee
Sprint 6
Employee Profile

Entities

Address

Bank

Education

Experience

Emergency Contact

Family

Documents

Features

Complete Employee Profile

Upload Documents

Bank Details

Education

Experience

Family Information
Sprint 7
HR Module

Entities

Attendance

Leave

Holiday

Shift

Roster

Weekend

Leave Balance

Features

Attendance

Check In

Check Out

Working Hours

Leave Balance

Holiday Calendar

Shift Assignment
Sprint 8
Leave Approval Workflow

Entities

Leave Approval

Approval History

Approval Comments

Workflow

Employee

↓

Team Manager

↓

Project Manager

↓

Department HR

↓

Approved

Features

Approval Levels

Notifications

Approval History

Comments

Escalation
Sprint 9
Payroll

Entities

Salary Structure

Salary Component

Payroll

Payslip

Tax

PF

ESI

Features

Payroll Run

Generate Payslip

Salary Revision

Bonus

Deductions
Sprint 10
Performance

Entities

Goal

Review

KPI

Rating

Promotion

Features

Goals

Reviews

Ratings

Promotion

Increment
Sprint 11
Asset Management

Entities

Asset

Asset Assignment

Asset Return

Asset History

Features

Assign Assets

Return Assets

Lost Assets

Repair

Replacement
Sprint 12
Recruitment

Entities

Job Opening

Candidate

Interview

Offer

Onboarding

Features

Hiring

Interview

Offer Letter

Employee Creation
Sprint 13
Security

Entities

Users

Roles

Permissions

Role Mapping

Audit Log

Features

Authentication

Authorization

Role Collections

Audit Logs
Sprint 14
Dashboard

Features

Employee Dashboard

HR Dashboard

Manager Dashboard

Project Dashboard

Organization Dashboard

Charts

Attendance

Leave

Projects

Payroll

Performance

Recruitment
Sprint 15
Notifications

Features

Email

In-App Notification

Leave Reminder

Birthday

Anniversary

Approval Pending
Sprint 16
Reports

Reports

Attendance

Leave

Payroll

Performance

Assets

Recruitment

Department

Project

Employee

Export

PDF

Excel

CSV
Sprint 17
Deployment
HANA

XSUAA

BTP

HTML5 Repository

Destination

CI/CD

Monitoring

Production Deployment
Database Hierarchy
Company
│
├── Business Unit
│
├── Location
│
├── Department
│
├── Department HR
│
├── Project
│
├── Project Manager
│
├── Team
│
├── Team Manager
│
├── Employee
│
├── Employee Profile
│
├── Attendance
│
├── Leave
│
├── Payroll
│
├── Performance
│
├── Assets
│
└── Recruitment
Prompt for the New Chat

Use this as the first prompt in your next chat:

I am building an enterprise-grade EWMS (Enterprise Workforce Management System) using SAP CAP (Node.js), SAP HANA Cloud, SAP Fiori Elements, and SAP BTP. Follow the sprint roadmap in my README. We will build one sprint at a time. Each sprint must include:

Enterprise-grade CDS database models with proper PK/FK relationships
Reusable common types, enums, and aspects
CAP services (srv)
JavaScript handlers with validations and business logic
Auto-generated business codes (e.g., COMP0001, BU0001, DEP0001, PROJ0001, TEAM0001, EMP000001)
Sample CSV data
Fiori-ready OData services
REST API examples for CRUD testing
Clear explanations of design decisions and relationships
Best practices for scalability and maintainability

Start with Sprint 1 (Common Foundation) and do not move to the next sprint until Sprint 1 is fully complete and tested

========================================================

Sprint 1 : Foundation
Step 1 - Create Project
cds init ewms
cd ewms
npm install

Step 2 - Project Structure
ewms
│
├── app/
│
├── db/
│   │
│   ├── common/
│   │   ├── aspects.cds
│   │   ├── enums.cds
│   │   ├── types.cds
│   │   └── validations.cds
│   │
│   ├── organization/
│   │   ├── company.cds
│   │   ├── business-unit.cds
│   │   ├── location.cds
│   │   ├── department.cds
│   │   ├── project.cds
│   │   ├── team.cds
│   │   ├── department-hr.cds
│   │   ├── project-manager.cds
│   │   ├── team-manager.cds
│   │   └── organization.cds
│   │
│   ├── employee/
│   │   ├── employee.cds
│   │   ├── designation.cds
│   │   ├── bank.cds
│   │   ├── address.cds
│   │   ├── education.cds
│   │   ├── experience.cds
│   │   ├── family.cds
│   │   ├── emergency-contact.cds
│   │   ├── document.cds
│   │   ├── certification.cds
│   │   ├── skill.cds
│   │   └── employee-profile.cds
│   │
│   ├── hr/
│   │   ├── attendance.cds
│   │   ├── leave.cds
│   │   ├── leave-approval.cds
│   │   ├── holiday.cds
│   │   ├── shift.cds
│   │   ├── overtime.cds
│   │   └── hr.cds
│   │
│   ├── payroll/
│   │   ├── salary-structure.cds
│   │   ├── salary-component.cds
│   │   ├── payroll-run.cds
│   │   ├── payslip.cds
│   │   ├── reimbursement.cds
│   │   └── payroll.cds
│   │
│   ├── performance/
│   │   ├── goal.cds
│   │   ├── kpi.cds
│   │   ├── review.cds
│   │   ├── appraisal.cds
│   │   └── performance.cds
│   │
│   ├── assets/
│   │   ├── asset.cds
│   │   ├── asset-category.cds
│   │   ├── asset-assignment.cds
│   │   └── assets.cds
│   │
│   ├── recruitment/
│   │   ├── job-opening.cds
│   │   ├── candidate.cds
│   │   ├── interview.cds
│   │   ├── offer.cds
│   │   ├── onboarding.cds
│   │   └── recruitment.cds
│   │
│   ├── security/
│   │   ├── role.cds
│   │   ├── permission.cds
│   │   ├── role-permission.cds
│   │   ├── user-role.cds
│   │   └── security.cds
│   │
│   ├── audit/
│   │   ├── audit-log.cds
│   │   └── notification.cds
│   │
│   ├── schema.cds
│   │
│   └── data/
│
├── srv/
│   ├── organization-service.cds
│   ├── employee-service.cds
│   ├── hr-service.cds
│   ├── payroll-service.cds
│   ├── performance-service.cds
│   ├── recruitment-service.cds
│   ├── assets-service.cds
│   ├── admin-service.cds
│   │
│   └── handlers/
│       ├── company.js
│       ├── department.js
│       ├── employee.js
│       ├── attendance.js
│       ├── leave.js
│       ├── payroll.js
│       └── workflow.js
│
├── package.json
└── README.md

Sprint Plan
Sprint 1
✅ Organization
Company
Business Unit
Location
Department

Sprint 2
Projects
Project
Team
Team Manager
Project Manager
Department HR

Sprint 3
Employee
Employee
Designation
Employee Profile
Address
Education
Experience
Bank
Documents
Emergency Contacts

Sprint 4
HR
Attendance
Leave
Holiday
Shift
Overtime

Sprint 5
Workflow
Employee

↓

Team Manager

↓

Project Manager

↓

Department HR

Sprint 6
Payroll
Salary Structure
Payroll
Payslip

Sprint 7
Performance
Goals
KPI
Reviews

Sprint 8
Assets
Laptop
Mobile
Accessories

Sprint 9
Recruitment
Job Opening
Candidate
Interview
Offer
Onboarding

Sprint 10
Security
Roles
Permissions
Authorization
Audit Logs

Development Rules
We'll follow these principles throughout the project:
Every table has a UUID primary key.
Every entity has a business code (e.g., COMP0001, DEPT0001, PROJ0001, TEAM0001, EMP000001) generated automatically.
Users never enter business codes manually.
All entities inherit audit fields (createdAt, createdBy, modifiedAt, modifiedBy) using managed.
Foreign keys are created through associations, not manual ID fields.
Business logic (code generation, workflow, validation) lives in service handlers.
Fiori Elements will be used to maintain all master data dynamically.
