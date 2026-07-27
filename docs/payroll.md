You can save this file as **`PAYROLL_ARCHITECTURE_SPEC.md`** in your repository root.

---

```markdown
# 🏛️ Enterprise Software Architecture Specification

## EWMS Core Payroll & Compliance Engine

| Document Metadata         | Details                                                                   |
| :------------------------ | :------------------------------------------------------------------------ |
| **Document ID**           | ENG-SPEC-PAYROLL-2026-V1.2                                                |
| **Project Name**          | Enterprise Workforce Management System (EWMS)                             |
| **Module**                | EWMS Payroll Engine (`ewms.db.payroll`)                                   |
| **Author / Owner**        | Namo Manikanta Sai (Software Development Lead)                            |
| **Framework / Core Tech** | SAP Cloud Application Programming Model (CAP), Node.js, SQLite / SAP HANA |
| **Status**                | Approved / Operational                                                    |

---

## 📋 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architectural Overview](#2-architectural-overview)
3. [Domain Data Architecture (CDS Models)](#3-domain-data-architecture-cds-models)
4. [Business Logic & Execution Workflows](#4-business-logic--execution-workflows)
5. [API Specification & Protocols](#5-api-specification--protocols)
6. [Data Seeding & Referential Integrity](#6-data-seeding--referential-integrity)
7. [Exception Handling & Resilience](#7-exception-handling--resilience)
8. [Audit & Operational Security](#8-audit--operational-security)
9. [Deployment & Runbook Guide](#9-deployment--runbook-guide)

---

## 1. Executive Summary

The **EWMS Payroll Module** provides a deterministic, batch-processable, and audit-compliant payroll computation engine. It processes complex salary structures, calculates loss-of-pay (LOP) based on attendance events, derives tax/statutory obligations, generates digital payslips, and logs every execution event into an immutable operational audit trail.

---

## 2. Architectural Overview
```

```
                      ┌───────────────────────────┐
                      │   HTTP / OData v4 Client  │
                      └─────────────┬─────────────┘
                                    │
                                    ▼

```

┌─────────────────────────────────────────────────────────────────────────────┐
│ Application Service Layer (srv/payroll/payroll-service.cds) │
├─────────────────────────────────────────────────────────────────────────────┤
│ Handlers / Business Logic (srv/payroll/handlers/payroll-engine.js) │
│ ├── ProcessPayroll() ───► Attendance Aggregation & LOP Derivation │
│ ├── ApprovePayrollBatch()───► Payslip Generation & History Logging │
│ └── Lock / Unlock () ───► State Validation Guardrails │
└───────────────────────────────┬─────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Persistence Layer (SQLite / SAP HANA DB) │
│ ├── PayrollPeriod ├── EmployeeSalary ├── SalaryStructure │
│ ├── SalaryStructureItem ├── SalaryComponent ├── PayrollProcess │
│ ├── PayrollDetail ├── PayrollHistory └── Payslip │
└─────────────────────────────────────────────────────────────────────────────┘

````

---

## 3. Domain Data Architecture (CDS Models)

The data domain is defined under the `ewms.db.payroll` namespace.

### 3.1 Data Model Inventory

| Entity Name | File Location | Functional Role |
| :--- | :--- | :--- |
| `PayrollPeriod` | `db/payroll/payroll-period.cds` | Defines calendar/fiscal pay cycles and processing flags. |
| `EmployeeSalary` | `db/payroll/employee-salary.cds` | Stores employee monthly CTC assignments and structure bindings. |
| `SalaryStructure` | `db/payroll/salary-structure.cds` | Template grouping individual pay components. |
| `SalaryStructureItem` | `db/payroll/salary-structure-item.cds` | Breakdown of fixed amounts or CTC percentages per structure. |
| `SalaryComponent` | `db/payroll/salary-component.cds` | Master registry of earnings, deductions, and tax types. |
| `PayrollProcess` | `db/payroll/payroll-process.cds` | Header entity storing net run results per employee per period. |
| `PayrollDetail` | `db/payroll/payroll-detail.cds` | Line-item calculation snapshot per component. |
| `PayrollHistory` | `db/payroll/payroll-history.cds` | Immutable audit trail for all processing/approval actions. |
| `Payslip` | `db/payroll/payslip.cds` | Employee payslip records published upon batch approval. |

---

## 4. Business Logic & Execution Workflows

### 4.1 Payroll Calculation Logic (`ProcessPayroll`)

The core execution algorithm strictly evaluates salary components via the following logic:

1. **State Validation:** Checks that the target `PayrollPeriod` exists and `isLocked === false`.
2. **Attendance & LOP Computation:**
   $$\text{LOP Days} = \text{Absent Days} + (0.5 \times \text{Half Days})$$
   $$\text{Payable Days} = \max(0, \text{Working Days} - \text{LOP Days})$$
3. **Component Pro-Ration (Earnings):**
   $$\text{Component Amount} = \left(\frac{\text{Base Component Rate}}{\text{Working Days}}\right) \times \text{Payable Days}$$
4. **Component Pro-Ration (Deductions):** Deductions are computed at full fixed/percentage rate or according to statutory formulas.
5. **Net Calculation:**
   $$\text{Gross Salary} = \sum \text{Calculated Earnings}$$
   $$\text{Net Salary} = \text{Gross Salary} - \sum \text{Deductions}$$
   *Validation Rule:* $\text{Net Salary} \ge 0$.

---

## 5. API Specification & Protocols

All endpoints are exposed over **OData v4** at endpoint namespace: `/odata/v4/payroll/`

### 5.1 Endpoint Definitions

#### 1. Execute Payroll Calculation Batch
* **Method:** `POST`
* **Path:** `/PayrollPeriods('{PeriodID}')/PayrollService.ProcessPayroll`
* **Headers:** `Content-Type: application/json`
* **Payload:**
  ```json
  {
    "otRateMultiplier": 1.50
  }

````

- **Success Response (`200 OK`):**

```json
{
  "@odata.context": "../$metadata#Edm.String",
  "value": "Payroll Execution Summary for Period 'PAY202607': Processed: 3, Exceptions/Failed: 0."
}
```

#### 2. Approve Batch & Generate Payslips

- **Method:** `POST`
- **Path:** `/PayrollPeriods('{PeriodID}')/PayrollService.ApprovePayrollBatch`
- **Success Response (`200 OK`):**

```json
{
  "@odata.context": "../$metadata#Edm.String",
  "value": "Batch Approval Complete! Approved 3 employee payroll records. Payslips generated."
}
```

#### 3. Fetch Audit Trail Records

- **Method:** `GET`
- **Path:** `/PayrollHistories?$orderby=performedOn desc`
- **Success Response (`200 OK`):**

```json
{
  "@odata.context": "$metadata#PayrollHistories",
  "value": [
    {
      "ID": "a1b2c3d4-0000-0000-0000-000000000003",
      "payrollProcess_ID": "f47ac10b-58cc-4372-a567-0e02b2c3d4e3",
      "action": "Processed",
      "performedBy_ID": "10000000-0000-0000-0000-000000000003",
      "performedOn": "2026-07-27T11:26:00.000Z",
      "remarks": "Payroll processed successfully. Payable days: 22/22."
    }
  ]
}
```

---

## 6. Data Seeding & Referential Integrity

CSV files loaded via `cds deploy` must follow strict referential rules:

1. **`ewms.db.payroll-EmployeeSalary.csv`**: Must contain mandatory non-null date `effectiveFrom`.
2. **`ewms.db.payroll-SalaryStructureItem.csv`**: Must only declare foreign keys (`salaryStructure_ID`, `salaryComponent_ID`) and allocation amounts/percentages. Property `calculationType` must remain solely in `SalaryComponent`.

---

## 7. Exception Handling & Resilience

- **Transactional Atomicity:** Bulk operations (`ProcessPayroll`, `ApprovePayrollBatch`) utilize `cds.transaction(req)` context.
- **Fail-Safe Batch Processing:** Individual employee processing failures inside the iteration loop log dedicated exceptions and terminal error outputs without terminating the entire HTTP thread.

---

## 8. Audit & Operational Security

- **Immutability:** Records inserted into `ewms.db.payroll.PayrollHistory` represent permanent point-in-time audit entries.
- **Access Control:** Production deployments enforce role-based authorization rules mapped via CDS annotations (`@requires: 'FinanceManager'`).

---

## 9. Deployment & Runbook Guide

### Local Development / Testing Execution Flow

```bash
# 1. Clean local SQLite cache
rm -f sqlite.db db.sqlite

# 2. Deploy schema and seed CSV datasets
cds deploy --to sqlite

# 3. Launch application server
cds watch

```

```

```
