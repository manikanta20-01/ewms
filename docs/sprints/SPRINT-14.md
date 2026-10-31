# Sprint 14 — Asset Management

**Status:** ✅ Completed

Sprint 14 adds full **Asset Management** to EWMS: organizational
assets (laptops, phones, vehicles, …) travel through a controlled
lifecycle — created, assigned to employees, returned, transferred,
inspected, repaired, retired, disposed — with complete history, exact
conditions at every hand-over, role-restricted access, notifications
and audit records. Everything reuses the existing building blocks
(Employee Core, Sprint 9 security, shared Notification core, shared
Audit helper). Backend only, no UI, no deployment.

---

## 1. Purpose

Track WHO holds WHICH asset, in WHICH condition, since WHEN — and keep
that history forever. A special design goal: **Sprint 21 (Exit
Management) will reuse this module** to clear departing employees by
answering, from data that already exists here:

1. Which assets are currently assigned to employee X?
2. Which assignments are active (outstanding)?
3. Which assets were returned, and in which condition?
4. What is the employee's complete assignment history?

## 2. Architecture

```
db/asset/asset.cds                       entities (history-first design)
srv/asset/asset-service.cds              OData V4 service + lifecycle actions
srv/asset/asset-security.cds             declarative @restrict (Sprint 9 roles)
srv/asset/asset-service.js               audit hook registration
srv/asset/handlers/asset-master.js       create/update guards, serial uniqueness
srv/asset/handlers/asset-lifecycle.js    all lifecycle actions + history events
db/common/enums.cds                      AssetStatus/Condition/AssignmentStatus/InspectionOutcome
test/asset.test.js                       44 automated tests (sections A–N)
```

### Entities

| Entity | Purpose | Key fields |
|---|---|---|
| `AssetCategory` | maintainable master data (rows, not hard-coded logic) | `code` (CAT…), `name`, `isActive` |
| `Asset` | one physical asset | `assetTag` (AST…), `name`, `category`, `serialNumber`, `model`, `manufacturer`, `purchaseDate/Cost`, `currency`, `warrantyUntil`, `status`, `condition`, `location`, `currentHolder` |
| `AssetAssignment` | ONE custody period (closed rows = history, never deleted) | `asset`, `employee`, `assignedBy`, `assignmentDate`, `expectedReturnDate`, `actualReturnDate`, `status`, `conditionAtAssignment`, `conditionAtReturn`, `acknowledged` |
| `AssetEvent` | append-only lifecycle history | `eventType`, `eventOn`, `actor`, `fromStatus`, `toStatus`, `condition`, `details` |

**History-first design:** the asset never stores an overwritable
"employee" field. `currentHolder` is a handler-maintained mirror of
the ACTIVE assignment (set on assign/transfer, cleared on return) so
lists and Exit Management can query holders in one read — the real
source of truth is the set of assignment rows:

```
Asset AST0001 ─┬─ Assignment 1 → Employee A (Returned, condition Good)
               ├─ Assignment 2 → Employee B (Returned, condition Fair)
               └─ Assignment 3 → Employee C (Active)   ← currentHolder
```

## 3. Statuses, conditions, transitions

- `AssetStatus`: `Available, Assigned, InRepair, Lost, Damaged,
  Retired, Disposed` (extended from the pre-existing, previously
  unused enum — no duplicates created).
- `AssetCondition`: `New, Good, Fair, Damaged, Critical`.
- `AssetAssignmentStatus`: `Active, Returned, Cancelled`.
- `AssetInspectionOutcome`: `Reusable, RepairRequired,
  RetireRecommended, DisposeRecommended`.

Allowed status transitions are enforced in `asset-lifecycle.js`
(`ASSET_TRANSITIONS` map); every other move → HTTP 400. Direct
`PATCH` of `status`, `condition` or `currentHolder_ID` is rejected —
only the actions own the lifecycle. Disposed assets are immutable.

## 4. Lifecycle actions (all on `Assets`)

| Action | From → To | Notes |
|---|---|---|
| `assignAsset(employee_ID, expectedReturnDate?, conditionAtAssignment?, notes?)` | Available → Assigned | employee must exist; exactly ONE active assignment (409 on retry); assignment row + notification + audit + event |
| `returnAsset(condition, notes?)` | Assigned → Available, **or InRepair when condition is Damaged/Critical** | requires active assignment (409 otherwise = duplicate-return safe); closes the row with `actualReturnDate` + `conditionAtReturn`; history kept |
| `transferAsset(newEmployee_ID, condition?, notes?)` | Assigned(A) → Assigned(B) | closes A's row, opens B's row, records a TRANSFERRED event; never an ID overwrite |
| `inspectAsset(condition, outcome, notes?)` | various | blocked while assigned (return first); `Reusable`→Available, `RepairRequired`→InRepair, `RetireRecommended`→Retired, `DisposeRecommended`→Disposed |
| `startRepair(vendor?, notes?)` / `completeRepair(condition, repairCost?, …)` | Available/Damaged/Lost → InRepair → Available | resulting condition recorded |
| `markLost(reason)` / `markDamaged(condition, reason)` | → Lost / Damaged | reason mandatory (never silent); the ACTIVE assignment stays open so accountability survives — recovery is `inspectAsset(…, Reusable)` |
| `retireAsset(reason)` / `disposeAsset(reason)` | → Retired / Disposed | blocked while assigned; reason mandatory; records preserved (no DELETE) |

`AcknowledgeAssignment` (on `AssetAssignments`): the receiving
employee confirms custody of their OWN active assignment (idempotent).

Every action also writes: one `AssetEvent` history row, an audit row
(shared `persistAudit`), and where useful a notification.

## 5. Authorization (reuses Sprint 9)

Declared in `asset-security.cds`:

| Who | Assets | Assignments | Actions |
|---|---|---|---|
| HRExecutive / HRAdmin / SystemAdmin | full read + CRUD | full read | all lifecycle actions |
| Employee / managers (row-level) | read only assets they currently hold | read own assignments (`employee_ID = $user`) / created by them (`assignedBy_ID = $user`) | `AcknowledgeAssignment` on own active rows |
| Everyone else | **no rows** (404 on foreign IDs) | **no rows** | 403 |

Category list is readable by all authenticated users (picklists);
category maintenance is HRAdmin/SystemAdmin.

## 6. Workflow integration

Deliberately **not wired in Sprint 14**: all operations are direct,
role-restricted HR/asset-admin actions, and no approval-controlled
operation was required. If a future sprint needs approval-controlled
disposal, the Sprint 10 generic engine attaches cleanly via
`registerCallbacks("ewms.db.asset.Asset", …)` — exactly like Leave,
Offers and Reviews — without structural changes. Documented extension
point; no second engine exists.

## 7. Notification & audit integration

- Notifications (shared `notify()` core, category `ASSET`):
  asset assigned (→ receiving employee), transferred (→ new holder),
  returned (→ assigner), lost (→ holding employee).
- Audit (shared `persistAudit` + standard `registerAuditHooks` for
  `Assets`, `AssetCategories`, `AssetAssignments`): asset created,
  every lifecycle transition, assignment created, acknowledgement.
  Readable via the existing SystemAdmin-only `AuditLogs` projection.

## 8. Future Exit Management integration (no exit code written)

The module already answers the Sprint 21 questions with plain OData:

```
GET /odata/v4/asset/AssetAssignments
      ?$filter=employee_ID eq <id> and status eq 'Active'      ← outstanding
GET /odata/v4/asset/AssetAssignments
      ?$filter=employee_ID eq <id> and status eq 'Returned'    ← history + conditionAtReturn
GET /odata/v4/asset/AssetEvents?$filter=asset_ID eq <id>       ← full asset story
```

## 9. API usage (OData V4)

Service root: `/odata/v4/asset` (mock auth:
`Authorization: Basic hrperson:`). Standard CRUD for
`AssetCategories`; CRUD + actions for `Assets`; read + acknowledge
for `AssetAssignments`; read-only `AssetEvents`.

## 10. Testing

`test/asset.test.js` — 44 tests, one shared `cds.test()` harness via
`test/setup.js`, in-memory `[test]` database, mock users. Covers:
asset master/CRUD + uniqueness (A), assignment rules (B), return incl.
damaged-return-to-repair (C), transfer history (D), inspection (E),
lost/damaged (F), repair + event history (G), retire/dispose + PATCH
guards (H), authorization incl. cross-employee protection (I),
notifications (K), audit (L), Exit-readiness queries (M), regression
smoke (N). Section J (workflow) is intentionally absent — no approval
flow was implemented (see section 6).

Run everything (Sprints 12–14 + all earlier suites):

```bash
npm test          # 117 tests, 0 failures, natural exit, code 0
```

Run only the Sprint 14 file:

```bash
CDS_ENV=test node --test test/asset.test.js
```

No deployment anywhere — SQLite locally, in-memory tests, HANA/XSUAA
only for the untouched `[production]` profile.
