# Sprint 17 — Documents & Compliance (Completion Report)

Status: **COMPLETE** (backend-only; implemented in place on top of the existing
`Documents` entity of the employee module and a new `compliance` service for
requirements and computed views).

## 1. Pre-conditions

- Sprint 16 (Geo Tracking & Geo-Fencing) passed its completion gate first — see
  `docs/sprints/SPRINT-16.md`. Full regression was run after that gate:
  **220 tests, 220 pass, 0 fail, exit code 0**.
- Sprint 17 builds on the existing `ewms.db.employee.Document` entity and the
  EWMS security/audit/background infrastructure. No duplicate document or
  workflow models were created.

## 2. What was implemented

### Document management (metadata + real file bytes)

- `db/employee/document.cds`: the existing entity gained status (`Active /
  Archived`), verification fields (`verificationStatus`, `verified`,
  `verifiedBy`, `verifiedOn`, `verifiedRemarks`, `rejectedReason`), content
  fields (`filePath` storage key, `fileSize`, `sha256`, `mimeType`),
  `issueDate` / `expiryDate` and timestamps. Content is **never** stored in the
  database — only sha256 + storage key.
- `srv/common/utils/document-catalog.js`: shared allowed-types catalog
  (Aadhar, PAN, Passport, Resume, Degree, EmploymentContract, AddressProof,
  MedicalCertificate, BackgroundCheck) used by both the employee and the
  compliance module.
- `srv/employee/handlers/document.js`:
  - CREATE validation: required metadata, catalog type check, duplicate guard
    (exactly one Active document per employee + type; replacement = archive
    old, upload new), expiry ≥ issue, size limit declared upfront.
  - Content upload path: bytes validated (magic-byte sniffing — no trust in
    filename/declared MIME), 10 MB configurable limit, sanitized
    traversal-free filename, stored OUTSIDE the DB through the storage
    abstraction in `srv/compliance/document-storage.js` (content-addressed
    hex keys under the private `document-store/` directory, dev default;
    production: `EWMS_DOCUMENT_STORAGE_DIR` to a mounted private volume — see
    below).
  - `filePath` is masked to `null` on every READ; only the bound
    `Download` action can return bytes.
  - Actions: `Download` (bound), `Verify`, `Reject` (reason mandatory),
    `Archive` — all guarded; direct DELETE is refused with a clear message,
    direct PATCH of verification/storage/content/employee fields is refused
    (attempts must go through the actions).
  - Verified row changes: metadata corrections by the owner allowed;
    verification fields locked.

### Storage abstraction

- `srv/compliance/document-storage.js`: tiny interface — `saveFile`, 
  `readFile`, `deleteFile` — with a LOCAL adapter (directory from
  `EWMS_DOCUMENT_STORAGE_DIR`, default `<project>/document-store/`,
  git-ignored, served
  by no HTTP route). Production must plug an S3/HDFS adapter implementing the
  same interface. **No production credentials are invented and no public
  folder is used.** Malware scanning is NOT implemented and is documented as a
  production requirement (AV scanning before Verify is acceptable policy).

### Access control

- `srv/employee/employee-security.cds`:
  - Employees: READ/UPDATE their own rows (where `employee_ID = $user.employeeId`),
    Download own bytes.
  - HRAdmin + SystemAdmin: full CRUD + Verify/Reject/Archive + Download of all.
  - Department/Project managers: deliberately no document access (privacy);
    verified by tests.
- The self-create guard (`assertSelfCreate`) enforces row ownership for CREATE
  (where-clauses only filter READs); HR-group may create on behalf of others.
- Audit: every Documents write and verification decision is recorded through
  the existing shared audit hooks (`registerAuditHooks`); verification is
  attributable via `verifiedBy` + AuditLogs.

### Compliance requirements and computed status

- `db/compliance/compliance.cds`: `DocumentRequirement` configuration (code
  auto-generated `REQn`, document type from the shared catalog, mandatory
  flag, applicability by employment type + effective date range, expiry alert
  window `expiryAlertDays` 0–365, `requiresIssueDate`), company scope rides on
  the org BusinessUnit association convention. Seeded with 5 requirements
  (PAN mandatory + issue date required, Passport optional, Degree mandatory
  for Permanent, EmploymentContract mandatory, MedicalCertificate mandatory
  with 180-day alert).
- `srv/compliance/handlers/{requirements,summaries,line}.js`:
  - Requirements: admin-only CRUD, enum + range validation, no direct status
    drift; config rows are validated against the catalog.
  - `ComplianceSummaries` and `ComplianceLines` are **@cds.persistence.skip
    computed views** — status is re-evaluated on every read and can never go
    stale. Rules:
    - no Active document → `Missing`
    - latest Active doc Pending → `Pending` (also: Verified but the
      requirement demands an issue date that is not filled in)
    - latest Active doc Rejected → `Rejected`
    - Verified + expiry past → `Expired`; Verified + expiry within the
      requirement's alert window → `Expiring`; else `Compliant`
    - Summary: any mandatory line Expired/Rejected → `Overdue`; any mandatory
      Missing/Pending → `Incomplete`; else `Compliant` (expiring warnings
      count but do not downgrade).
  - Access: HR trio + SystemAdmin see everyone; plain employees see only
    their own scope; foreign `employee_ID` filter requests are rejected; a
    plain manager has NO compliance views by design.

### Notifications and reminder action

- `NotifyDocumentExpiries(daysBefore)` action on the compliance service —
  manual, cron-ready (there is NO built-in scheduler in the repository, so
  this action is the documented integration point; it is NOT an automatic
  scheduler). Uses the existing Notification service only:
  - retries: dedupe on recipient + sourceRecord + title, so re-running the
    action never sends the same reminder twice;
  - permission-safe messages (no file content, no storage keys);
  - schedule integrations are documented in the guide, not claimed active.

## 3. Test evidence

**Final completion-gate re-verification** (immediately before starting
Sprint 18): targeted suite 23/23 pass (exit 0), full `npm test` regression
220/220 pass (exit 0), `npx cds compile srv --to csn` exit 0, `npx cds
compile db --to hana` exit 0.

Targeted suite `test/compliance.test.js` (**23 tests, 23 pass, 0 fail, 0
skipped, exit 0**) covers:

- metadata validation, catalog types, missing fields,
- allowed/forbidden content types + magic-byte sniffing, size limits,
- upload/download byte round-trip, storage-key masking, path-traversal safety,
- employee self-access, cross-employee denials, manager denial (no document
  API for managers), HR/Admin grants, direct unauthorized CREATE/PATCH/DELETE
  rejections,
- verify/reject/archive lifecycle guards (double verify 409, reject-after
  verify 409, rejected docs cannot be deleted, PATCH bypass refused,
  reason-required rejection), audit rows present,
- requirement configuration: admin-only CRUD, catalog enum + 0–365 range,
  employee denial (403),
- compliance computation: Missing/Pending/Rejected/Expired/Expiring/Compliant,
  presence-is-not-compliance (PAN without issue date stays Pending),
  mandatory-only summary status, employment-type applicability,
- duplicate uploads/refused re-retries/safe archive-then-retry,
- notification behavior: expiry reminders + missing-requirement reminders
  with dedupe on re-run, employee-scoped notification reads.

Full regression after all Sprint 17 changes: **220 tests, 220 pass, 0 fail,
0 skipped/cancelled, exit code 0** (`CDS_ENV=test npm test`).

CDS compilation: `npx cds compile srv --to csn` → exit 0;
`npx cds compile db --to hana` → exit 0.

## 4. Changed / added files

Added:

- `db/compliance/compliance.cds`,
  `db/data/ewms.db.compliance-DocumentRequirement.csv`,
- `srv/compliance/compliance-service.cds`, `compliance-security.cds`,
  `compliance-service.js`, `handlers/requirements.js`,
  `handlers/summaries.js`,
- `srv/compliance/document-storage.js` (storage adapter interface),
- `srv/common/utils/document-catalog.js` (shared allowed-types catalog),
- `test/compliance.test.js`,
- `docs/sprints/SPRINT-17.md`.

Changed:

- `db/employee/document.cds` — document status/verification/storage fields,
- `srv/employee/handlers/document.js` — full upload/verify/reject/archive/
  download validation, action security, content sniffing,
- `srv/employee/employee-security.cds` — Documents + compliance grants
  (employees self-scope; HRAdmin/SystemAdmin CRUD + lifecycle actions),
- `srv/services.cds` — compliance service exposure,
- `db/schema.cds`, `db/common/enums.cds` — compliance field/enum wiring,
- `test/setup.js` — harness PATCH helper exposure for the new suites,
- `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md`, `SETUP.md` — documentation.

## 5. SQLite / HANA differences & production storage requirements

- SQLite dev DB stores only the storage KEY + hash, never bytes; that is the
  same on HANA (schema-identical), so no HANA-specific behavior differs this
  sprint.
- `@cds.persistence.skip` computed compliance entities work on both (pure
  in-memory computation over SQL reads).
- Production storage must be an adapter for `srv/compliance/document-storage.js`
  (S3/HDFS or managed object store) or at minimum the
  `EWMS_DOCUMENT_STORAGE_DIR` env var pointed at a mounted private volume,
  and configured BEFORE go-live; the local dev directory is explicitly not a
  production pattern. Malware scanning must be added at the production
  boundary.

## 6. Remaining policy decisions / limitations (not done, documented)

1. **Malware scanning is not implemented** — must be provided at the
   production storage boundary.
2. **Retention/deletion policy** is deliberately not hard-coded; policy is
   "archive, never hard-delete" this sprint. Statutory retention periods need
   HR/legal/business configuration before implementation — the architectural
   hook is `Archive`.
3. **Background reminders are manual/cron-external** — the repository has no
   scheduler; the `NotifyDocumentExpiries` action is idempotent and safe to
   call from any external cron job (dedupe prevents duplicate reminders).
4. Country-specific document names in the catalog are business configuration
   (editable rows), not law enforcement — HR/legal confirmation of the
   requirement sets is required before productive use.
5. Malware scanning, S3 storage adapter, cron/external reminder scheduling,
   email notification channel, Fiori/UX — Sprint 18+ or production phases.
