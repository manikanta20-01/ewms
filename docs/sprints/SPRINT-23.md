# Sprint 23 — Reports & Export Backend (Local-Only, Fiori/UI5-Ready)

Backend-only reporting and CSV-export capability over the EXISTING
module data, reusing the Sprint 22 analytics helpers as the single
source of metric logic. No new frontend, no Fiori/UI5 module, no new
dependencies (the CSV builder is a project-local ~80-line utility).

**Prerequisite gate:** see `docs/sprints/SPRINT-22-AUDIT.md` — the gate
PASSED after the verified Sprint 22 gap (a completely absent dashboard
module) was implemented and verified (356/356 full suite, both CDS
compiles exit 0). Only then did Sprint 23 work begin.

---

## 1. Implemented reports (`ReportsService`, `/odata/v4/reports`)

All nine report types are COMPUTED at read time
(`@cds.persistence.skip`) — nothing stored, nothing stale, and no
duplicate entity of any module data was created.

| Report (entity) | Rows | Data source (existing module) |
|---|---|---|
| `Workforce` | one row per employee: code, names, status, employmentType, joiningDate, department | Employee + latest EmployeeHistory (repo-wide rule) + Department |
| `Attendance` | one row per attendance record: date, status, workLocation, workedHours, lateMinutes | Attendance |
| `Leave` | one row per request: number, employee, type, status, dates, totalDays | LeaveRequest + LeaveType |
| `Recruitment` | stage counts for Candidates / Offers / OnboardingCases | Candidate, Offer, OnboardingCase |
| `Performance` | stage counts for Reviews / Goals | PerformanceReview, PerformanceGoal |
| `Asset` | one row per asset incl. CURRENT holder from the ACTIVE assignment (ledger is the authority), condition | Asset, AssetAssignment, AssetCategory |
| `DocumentExpiry` | one row per Active document with expiry: type, number, status (Valid/Expiring/Expired/PendingVerification), daysUntilExpiry | Document + ACTIVE DocumentRequirement config (Sprint 17 rule reused verbatim) |
| `Helpdesk` | ticket counts per category/status/priority | HRTicket |
| `Exit` | counts per Status/Type stage | ExitCase |

Metric definitions that matter (beginner comments in code):

- **No duplicate counting**: headcount/funnel aggregation uses
  DISTINCT sets of IDs (headcount: per latest history row; holder map:
  one row per asset); helpdesk totals are cross-checked in tests
  against raw SQL GROUP BY totals.
- **Empty result sets** are a clean `200` with an empty `value` list;
  an empty CSV still carries the header row.
- **Document status language** follows the compliance module: only
  VERIFIED documents can count as Valid/Expiring/Expired; an
  unverified one is `PendingVerification` regardless of dates.
- **Expiry windows are configured** (`expiryAlertDays` of the ACTIVE
  requirement rows), never hardcoded; a type without a configured
  window has no "expiring" bucket.

## 2. Filters, validation, pagination, limits

- Interactive reads are standard OData entity reads — a future Fiori
  Elements list report can consume them directly:
  `GET /odata/v4/reports/Workforce?$filter=department_ID eq ... and employeeStatus eq 'Active'`
- `$filter` must name the entity's OWN columns (CAP enforces this at
  the protocol level — no synthetic filter fields to spoof). The date
  axis per report: Workforce→`joiningDate`, Attendance→
  `attendanceDate`, Leave→`fromDate`, DocumentExpiry→`expiryDate`,
  Helpdesk/Exit→`createdAt` — used with the ordinary `ge`/`le`
  operators (inclusive bounds).
- Only `eq` (and the date-axis comparison ops) are ever honored — a
  filter can never EXPAND a report beyond its supported set, so the
  endpoint cannot become a row-security bypass.
- **Date-range validation** (interactive AND export): fromDate/toDate
  must appear together, from ≤ to, and the span may not exceed 366
  days (`400` otherwise). Timezone assumption: dates are plain ISO
  `YYYY-MM-DD`; "today" = the UTC date (SQLite stores no timezone —
  documented decision).
- **Pagination/limits**: `$top` is honored server-side and clamped to
  an interactive cap of 250 rows. Larger reads must use the export
  with its explicit `limit` — unbounded queries impossible.
- **Export cap**: the export refuses (`413`) when the report has more
  rows than the requested `limit` (max 10,000, default 5,000). It is
  never silently truncated — a cut-off export would look complete.

## 3. Export (`POST /ExportCSV`)

One unbound action with typed parameters that MIRROR each report's
supported filters (bound actions cannot carry `$filter`, so the
parameters keep the filter parity structural — same builders run for
both surfaces):

```
POST /odata/v4/reports/ExportCSV
Content-Type/Auth: as the OData API

{ "report": "Workforce", "department_ID": "...", "status": "Active",
  "fromDate": "2026-01-01", "toDate": "2026-12-31", "limit": 1000 }
```

- Response: the CSV text as the OData string value
  (`{ "value": "EmployeeCode,FirstName,..." }`), plus the download
  metadata headers.
- **Content-Disposition** header: `attachment; filename="ewms-<report>-<yyyymmdd>.csv"`
  (verified by tests; contains only the report type and the date —
  never personal or sensitive data).
- Content type note: OData non-stream action results are
  `application/json` per protocol; the CSV TEXT arrives inside the
  JSON string `value`. A future Fiori download button decodes that
  one string (or GETs a media surrogate later). This is honest about
  the wire format instead of faking `text/csv` on a JSON body.
- **Safe CSV generation** (project-local builder
  `srv/common/utils/csv-builder.js`, dependency-free):
  - RFC-4180 quoting: commas, `"` (doubled), and embedded newlines
    are quoted correctly;
  - **formula-injection protection**: values leading with `=`, `+`,
    `@`, tab/CR — and `-` ONLY when it reads as a formula lead-in
    (`-=`, `--`) — get a single leading apostrophe so spreadsheets
    open them as text. Plain numbers (`-5`, `-0.50`) are never
    corrupted (test-asserted);
  - `null` → empty cell; numbers/booleans plain.
- **Errors**: unknown report → 400 (with the supported list);
  validation → 400; cap breach → 413; internal failure → a clean 500
  message with no SQL/stack details to the client (details stay in
  the server log).
- **Audit**: every export writes a shared-AuditLog row with the
  report name + filter facts ONLY (no report contents, no samples).

## 4. Authorization and privacy

- The role map lives in `reports-security.cds` AND is re-checked in
  the handlers (computed entities cannot carry row policies — the
  helpdesk OverdueTickets double-lock pattern).
- **All nine reports**: `HRExecutive`, `HRAdmin`, `SystemAdmin`. The
  asset report additionally allows `FinanceManager` (the asset
  module's own rule).
- **Everyone else is denied — deliberately**: plain employees and
  managers get 403 even for filters naming their own IDs (tests
  assert this). Reports aggregate/serialize personal rows (names,
  attendance, document numbers); their per-module services already
  provide the scoped self-service views, and widening this surface
  would only create a bypass route.
- Sensitive fields never enter reports: no compensation, no salary,
  no exit reasons (Sprint 21 text), no candidate contacts; the
  Workforce report is name/code/structure only. Tests assert the
  absence of sensitive columns in the payload shape.

## 5. Tests (`test/reports.test.js`)

28 tests / 6 suites (targeted run: **28/28 pass, exit 0**):
authorization (employee/manager/finance denials incl. the export),
filter validation & boundaries (one-sided, inverted, >366 days,
max-range accepted, empty sets, `$top`), data correctness vs
INDEPENDENT SQL (incl. a live recruitment candidate creation through
the real service, boundary-inclusive date tests, legacy `Approved`
leave statuses, helpdesk no-duplicate totals), export behaviors
(metadata + filename pattern, filter parity with the READ, unknown
report 400, unbounded 413, same authorization map, audit facts-only),
and CSV-safety unit tests (RFC quoting, injection guard + non-corruption
of legitimate data).

## 6. Verification evidence (all local)

| Check | Result |
|---|---|
| `node --test test/reports.test.js` targeted | **28/28 pass, 0 fail, exit 0** |
| `npm test` (full suite) | **384 tests / 114 suites, 384 pass, 0 fail, 0 cancelled, 0 skipped, exit 0** (~70 s, natural termination) |
| `npx cds compile srv --to csn` | **exit 0**, 0 warnings |
| `npx cds compile db --to hana` | **exit 0**, 0 warnings (local syntax check only — NO HANA connection) |

## 7. Exact local commands to try it

```bash
# start the backend locally (existing project setup):
npm start            # serves all services on http://localhost:4004
# (or: npx cds-serve;  CDS_ENV=test node --test test/reports.test.js for tests)

# read a report (mock users live in package.json; Basic auth, empty password):
#   hrperson / empjohn / mgrdept / finmgr / payexec / sysadmin
curl -u hrperson: "http://localhost:4004/odata/v4/reports/Workforce"
curl -u hrperson: "http://localhost:4004/odata/v4/reports/Attendance?\$filter=attendanceDate ge 2026-07-01 and attendanceDate le 2026-07-31"
curl -u hrperson: "http://localhost:4004/odata/v4/reports/Helpdesk?\$top=2"

# generate a CSV export (CSV text arrives as the JSON string value):
curl -u hrperson: -X POST "http://localhost:4004/odata/v4/reports/ExportCSV" \
  -H "Content-Type: application/json" \
  -d '{"report":"Workforce","limit":1000}'
curl -u hrperson: -X POST "http://localhost:4004/odata/v4/reports/ExportCSV" \
  -H "Content-Type: application/json" \
  -d '{"report":"Attendance","fromDate":"2026-01-01","toDate":"2026-12-31"}'
```

## 8. Known limitations / remaining risks (documented, not blocking)

1. **CSV arrives inside the JSON action envelope** (OData protocol
   fact); the front-end download needs one string decode. A future
   media-surrogate endpoint could stream raw `text/csv` if a UI
   sprint needs a direct link.
2. **Payroll reports are NOT included** — no requirement list asked
   for payroll aggregation beyond existing payslip access controls,
   and inventing compensation aggregates was explicitly forbidden.
   Can be added later on the same builder pattern if HR requires it.
3. **Compliance per-requirement fulfillment** (compliant vs
   non-compliant per requirement) is not aggregated here; the
   compliance module already computes per-employee status and
   `DocumentExpiry` covers the expiry axis. A follow-up could
   aggregate that per requirement without new logic duplication.
4. Row caps are server constants (250 interactive / 10,000 export);
   making them configurable would be a one-line change but no
   requirement asked for it.
5. SQLite-only runtime verification; HANA/BTP runtime profile remains
   untested (standing project limitation). Production readiness is
   NOT claimed from local tests.

## 9. Confirmations

- No deployment, publish, push, upload, or remote server connection
  was performed; nothing was committed to Git.
- No remote HANA interaction: `cds compile db --to hana` is a local
  model-compile check only.
- No credentials or personal/payroll data were written to logs,
  filenames, or error messages (test-asserted where applicable).
- Standing on `npm test` 384/384 + both compiles exit 0 at the end.

## 10. Files added / changed

Added: `srv/reports/reports-service.cds`, `srv/reports/reports-security.cds`,
`srv/reports/reports-service.js`, `srv/reports/handlers/reports-common.js`,
`srv/reports/handlers/report-builders.js`, `srv/reports/handlers/reports-reader.js`,
`srv/common/utils/csv-builder.js`, `test/reports.test.js`,
`docs/sprints/SPRINT-23.md`, `docs/sprints/SPRINT-22-AUDIT.md`.

Changed: `srv/services.cds` (register ReportsService), plus the
Sprint 22 files listed in SPRINT-22.md §5 (dashboard module, shared
analytics helpers, tests, docs).

**Final status: COMPLETE** — stopped here; Sprint 24 has NOT been
started.
