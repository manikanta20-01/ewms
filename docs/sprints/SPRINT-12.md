# Sprint 12 – Offer Letter + Onboarding + Employee Conversion

**Module:** Recruitment (Offer Letter), Onboarding, Employee Conversion
**Status:** ✅ Completed
**Approach:** Reuse the existing EWMS building blocks – Employee Core,
Workflow Engine, Security/Authorization, Audit, Notifications
(extension point only), Documents conventions. No second workflow
engine, no second audit system, no separate document management system.

---

## 1. Scope

```
Candidate
  → Offer Draft
    → Submit Approval
      → Workflow Approval (existing engine)
        → Approved → Sent
          → Candidate Accepts
            → Onboarding Case Created (auto)
              → Onboarding Tasks + Required Documents
                → Employee Conversion (idempotent)
                  → Duplicate Conversion Prevented
```

Alternative endings are fully supported: offer **rejected**,
**withdrawn**, **expired**, and invalid state transitions blocked.

---

## 2. Model (CDS)

### Offer – `ewms.db.recruitment.Offer`

Key fields: `offerNumber` (auto `OFF...`), candidate, department,
designation, reporting manager, employment type, offer/expiry/joining
dates, `offeredCTC` (compensation), work location, benefits/terms,
notes, status, timestamps.

Status model:

```
Draft → PendingApproval → Approved → Sent → Accepted
                              ↓         ↓
                          Withdrawn  Rejected
                              ↓
                           Expired
```

### OnboardingCase – `ewms.db.recruitment.OnboardingCase`

Key fields: candidate, offer, joining date, department, designation,
reporting manager, coordinator, `progress` (0-100, recalculated on
every task change), notes, `convertedEmployee` (association to the
existing `Employee`, foreign key `convertedEmployee_ID` – the
idempotency marker), timestamps.

Status model: `NotStarted → InProgress ⇄ OnHold → Completed`,
`Cancelled` from every non-final state.

### OnboardingTask

`taskCode`, title, description, assignee, due date, `isMandatory`,
status `Pending → InProgress → Completed` (plus `Skipped`, `Blocked`,
re-openable), completion metadata. Tasks are **seeded automatically
from the reusable OnboardingChecklist templates** when onboarding
starts.

### OnboardingDocumentRequirement

Reuses the existing document conventions: `Required → Submitted →
Verified` (plus `Rejected`, `Waived`). Stored per onboarding case; no
separate document system was built.

---

## 3. Operations

### Offer lifecycle actions (`RecruitmentService`)

| Action | From → To | Who |
|--------|-----------|-----|
| `SubmitForApproval` | Draft → PendingApproval (+ starts workflow) | HRExecutive, HRAdmin, SystemAdmin |
| `ApproveOffer` / `RejectOffer` | direct HR fallback | HRAdmin, SystemAdmin |
| `SendOffer` | Approved → Sent | HRExecutive, HRAdmin, SystemAdmin |
| `RecordAcceptance` | Sent → Accepted (+ auto onboarding case) | HRExecutive, HRAdmin, SystemAdmin |
| `RecordRejection` | Sent → Rejected | HRExecutive, HRAdmin, SystemAdmin |
| `WithdrawOffer` | Draft/PendingApproval → Withdrawn | HRExecutive, HRAdmin, SystemAdmin |
| `ExpireOffer` | active → Expired | HRExecutive, HRAdmin, SystemAdmin |

Every action validates the transition (`assertTransition`) – invalid
moves are rejected with a clear 400 message. Direct `PATCH` updates can
never change `status`, and accepted offers are frozen completely.

### Onboarding actions

`StartOnboarding`, `HoldOnboarding`, `ResumeOnboarding`,
`CompleteOnboarding`, `CancelOnboarding`, `ConvertToEmployee`;
tasks: `StartTask`, `CompleteTask`, `SkipTask`, `BlockTask`,
`ReopenTask`; documents: `SubmitDocument`, `VerifyDocument`,
`RejectDocument`, `WaiveDocument`.

`CompleteOnboarding` blocks (400) while any **mandatory** task or any
document requirement is still open, and sets `completedAt`.

---

## 4. Workflow Integration (existing engine, no second engine)

- `SubmitForApproval` calls the existing generic workflow engine
  (`srv/workflow/handlers/workflow-engine.js`) with
  `businessObjectType = ewms.db.recruitment.Offer`.
- The seeded definition **`WF-OFFER-STD`** (SingleSequential, one step
  "HR Approval", approver type `LevelHR`, SLA 5 days) creates the task.
- Approving/rejecting the task through `WorkflowService.Approve/Reject`
  triggers the registered business callback, which moves the offer to
  `Approved` (or keeps it `PendingApproval` for HR to handle after a
  rejection).
- If no active workflow definition exists, the offer stays
  `PendingApproval` and HR uses the direct `ApproveOffer` fallback.

---

## 5. Employee Conversion (idempotent, reuses Employee Core)

`ConvertToEmployee` (on a `Completed` case only):

1. **Already converted?** The `convertedEmployee_ID` association is the
   single source of truth – a repeat call returns the existing employee
   and never creates a second one (returns a human-readable message).
2. Loads the candidate; if an employee with the same email already
   exists it is **linked** instead of duplicated.
3. Otherwise inserts into the EXISTING `ewms.db.employee.Employee`
   plus an active `EmployeeAssignment` (department, designation,
   reporting manager carried from the offer; employee code from the
   shared generator, `EMP000001` numbering preserved).
4. Sets `convertedEmployee_ID` **inside the same transaction** (a
   failed run cannot leave a half state), marks the candidate `Hired`,
   and writes an audit row.

Authorization: **HRAdmin / SystemAdmin only** – enforced
declaratively in `srv/recruitment/recruitment-security.cds`
(`{ grant: ['ConvertToEmployee'], to: ['HRAdmin', 'SystemAdmin'] }`),
so no duplicated handler-level role check is needed. Automated tests
prove the 403 for a plain employee and successful conversion for an
authorized admin.

---

## 6. Authorization (existing Sprint 9 architecture)

Declarative `@restrict` annotations only – see
`srv/recruitment/recruitment-security.cds`:

- Recruitment data is **confidential**: plain `Employee` has no access
  at all (candidates are personal data of non-employees).
- `Offers`: read for HR/Finance/SystemAdmin; the hiring manager
  (`DepartmentManager`) may read only offers where they are the
  reporting manager (`where` clause) – and the offered compensation is
  **masked in code** for roles without CTC visibility
  (`maySeeCompensation` in `offer-lifecycle.js`).
- `OnboardingTasks`: employees may read and work (`StartTask`,
  `CompleteTask`) only their **own** tasks (`assignee_ID = $user.employeeId`).
- `ConvertToEmployee`: HRAdmin/SystemAdmin only (see above).

Audit reuse: important lifecycle operations write rows through the
existing `persistAudit` helper into the existing audit log; automated
tests verify audit rows for offer creation.

Notifications: used **only** as the existing extension point; nothing
was redesigned or expanded.

---

## 7. Testing

Automated suite (real project files, visible in VS Code):

- `test/setup.js` – shared bootstrap: **one** `cds.test()` server per
  test file, in-memory `[test]` profile database, mocked users;
  controlled CAP shutdown, no `process.exit()`.
- `test/recruitment.test.js` – 31 tests covering:
  - service smoke (Employee/Leave/Workflow/Notification still respond)
  - offer creation, validation (candidate required, expiry ≥ offer date)
  - full lifecycle: submit → workflow approve → send → accept
  - record rejection (+ rejected offer cannot be accepted)
  - withdraw, expire (+ expired is final, Draft cannot expire),
    invalid transitions, compensation masking
  - accepted offers cannot be modified
  - onboarding auto-creation, task guards, mandatory-task skip block,
    completion guard, task/doc completion
  - conversion before completion blocked, full happy path, idempotent
    repeat conversion (duplicate prevented), candidate → Hired
  - authorization negatives (403 for plain employee), audit rows

Run:

```bash
npm test
```

All 30 tests pass and the process exits naturally with code 0.

Manual API examples: `test/recruitment.http` (mirrors the automated
flow step by step with the mocked users).

---

## 8. Files

| Area | Files |
|------|-------|
| Model | `db/recruitment/recruitment.cds`, `db/common/enums.cds` |
| Service | `srv/recruitment/recruitment-service.cds`, `srv/recruitment/recruitment-security.cds`, `srv/services.cds` |
| Handlers | `srv/recruitment/handlers/offer-lifecycle.js`, `onboarding-lifecycle.js`, `onboarding-creation.js`, `employee-conversion.js` |
| Seed data | `db/data/ewms.db.workflow-WorkflowDefinition.csv`, `WorkflowStep.csv` (WF-OFFER-STD) |
| Tests | `test/setup.js`, `test/recruitment.test.js`, `test/recruitment.http` |
| Docs | `SETUP.md`, `readme.md`, this file |

---

## 9. Sprint 12 Completion Summary

- CDS compile: **PASS** (`cds compile srv --to csn`, `db --to hana`,
  service EDMX)
- Server boot: **PASS** (all services load, auth enforced)
- Automated tests: **31/31 PASS**, natural process exit (code 0)
- Offer lifecycle incl. reject/withdraw/expire + invalid transitions: **PASS**
- Workflow approval (existing engine, WF-OFFER-STD): **PASS**
- Onboarding cases/tasks/document requirements: **PASS**
- Employee conversion + duplicate prevention (idempotent): **PASS**
- Authorization (incl. compensation masking, ConvertToEmployee 403): **PASS**
- Audit reuse: **PASS**
- Regression (existing services still respond): **PASS**
