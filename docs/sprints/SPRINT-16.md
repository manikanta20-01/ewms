# Sprint 16 — Geo Tracking & Geo-Fencing

**Status: Implemented (backend-only, SQLite verified; HANA DDL compiles)**

Builds on Sprint 5 (Attendance) without rebuilding it, and sets up the
integration hooks a future mobile/Fiori check-in app will call.

## 1. What was built

| Layer | File(s) | Purpose |
|---|---|---|
| Data model | [db/geo/geo.cds](../db/geo/geo.cds) | `Geofence` (configurable work place: center coordinates + radius, active status, effective dates), `EmployeeLocationEligibility` (optional per-employee fence restriction), `AttendanceLocationEvent` (one evidence row per geofence evaluation, server-generated), `GeofenceHistory` (append-only configuration ledger) |
| Reusable validator | [srv/geo/geofence-validator.js](../srv/geo/geofence-validator.js) | The single place evaluating a submitted location: range/malformed checks, staleness window, remote-work exception, active+effective fence selection, eligibility filtering, haversine distance with a deterministic boundary rule, evidence recording |
| Service | [srv/geo/geo-service.cds](../srv/geo/geo-service.cds) / .js / [handlers/*](../srv/geo/handlers) | Configuration CRUD with auto `GF000n` codes, `ActivateGeofence` / `DeactivateGeofence` (conditional, race-safe), eligibility overlap guards, history writes, DELETE blocked by design |
| Security | [srv/geo/geo-security.cds](../srv/geo/geo-security.cds) | Admin-only configuration; events readable by owner + HR roles only; **no write grants on evidence/history rows for any role** |
| Attendance integration | [srv/attendance/handlers/attendance.js](../srv/attendance/handlers/attendance.js) + input-only fields in [db/attendance/attendance.cds](../db/attendance/attendance.cds) | Check-in / check-out requests may carry `latitude` / `longitude` (+ `locationTimestamp`); the fields are `@cds.persistence.skip` — never stored on Attendance, evaluated by the validator and recorded as rounded evidence |
| Seeds | [ewms.db.geo-Geofence.csv](../db/data/ewms.db.geo-Geofence.csv) | Two demo fences (Bengaluru HQ, Electronics City) for dev/test |
| Tests | [test/geo.test.js](../test/geo.test.js) | 18 tests covering the full acceptance list |

## 2. Evaluation policy (deterministic, tested)

For an attendance request that carries coordinates:

1. **Input hygiene first** — coordinates must be numbers in range
   (lat −90..90, lng −180..180); `locationTimestamp`, when sent, may be
   at most 15 minutes old (staleness window) and at most 5 minutes in
   the future. Violations reject the attendance request with 400.
2. **Remote-work exception** — `workLocation = WorkFromHome` requests
   are recorded but never fenced (legitimate off-site/remote work
   preserved). Result: *Bypassed*.
3. **Opt-in geofencing** — if no ACTIVE + effective fence exists for
   the event date, validation is bypassed. Employees are never blocked
   because no fence is configured (B4: no universal fence mandate).
4. **Eligibility narrows, never widens** — if the employee has active
   eligibility rows covering the date, only those fences count; if the
   intersection is empty → *Bypassed (not eligible)*. No rows → all
   active fences count (default permissive policy).
5. **Nearest allowed fence decides** — haversine distance ≤ radius →
   *Passed* (evidence row with the matched fence + distance). Outside →
   the request is **rejected with 400** and the transaction rolls back,
   so **no evidence row is stored for failed evaluations**.

Boundary rule: outward comparison uses a 0.5 m tolerance documented in
the validator; "outside" means strictly greater than the radius.

## 3. Security & privacy decisions

- **Server-computed results**: the evidence row's `result` is never
  accepted from the client — there is no CREATE/UPDATE/DELETE grant on
  `AttendanceLocationEvents` for ANY role (tested 403), and the value
  is written only by the validator.
- **No coordinates on Attendance**: the three geo fields on Attendance
  are `@cds.persistence.skip` — attendance list responses therefore
  cannot leak coordinates by construction.
- **Evidence precision**: stored coordinates are rounded to 4 decimals
  (~11 m grid). Full-precision client coordinates are not kept.
- **Read scope**: employees see only their own evidence rows; HRExecutive
  / HRAdmin / SystemAdmin see all (their attendance responsibility).
  Department/Project managers deliberately have **no** read on evidence
  rows — their line of sight remains the Attendance entity, which keeps
  the precise-location exposure smaller than general attendance access.
- **Minimal collection**: nothing polls, pushes or logs positions in
  the background; an event exists only when an employee submitted
  coordinates for a check-in/check-out operation they initiated.
  No anti-spoofing is claimed — client-supplied coordinates CAN be
  spoofed; device attestation is out of scope and not claimed anywhere.
- **Configuration audit**: every geofence create/update/activate/
  deactivate writes one `GeofenceHistory` row (append-only, guarded)
  plus the shared, sanitized `AuditLog`.
- **Retention (level set, not invented)**: events are operational
  evidence retained in the EWMS database with the row-level rules above;
  periodic purging is intentionally NOT implemented (a scheduled job /
  legal-hold policy is an HR/legal decision — see §5).

## 4. Test results (this sprint)

| Check | Result |
|---|---|
| `CDS_ENV=test node --test test/geo.test.js` | **18/18 pass** |
| Full `npm test` (exit status verified with `pipefail`) | **197 tests / 197 pass / 0 fail / 0 skipped, exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` | exit 0 |

Coverage: coordinate/radius ranges · distance + boundary · inactive &
future-effective fences · eligibility restriction + immutability ·
bypass paths (remote work, deactivated fence, no eligibility) ·
check-in/check-out integration · duplicate/retry safety · staleness ·
malformed input · cross-employee denial · manager no-read · admin-only
config · server-only evidence writes · history + audit rows.

## 5. Remaining limitations / policy decisions (documented)

1. **GPS coordinates are client-supplied and spoofable.** EWMS records
   *evidence*, not proof of physical presence; no claim of anti-spoofing
   is made. Device attestation / network triangulation would be a later,
   separate capability.
2. **Retention purge job not implemented** — needs an explicit legal
   retention decision (e.g. 90 days) and a background job framework,
   which the repo does not have yet.
3. **HANA production profile not exercised at runtime** (like every
   sprint so far). The SQLite `[test]` profile verifies behavior; the
   HANA DDL compiles. One implementation note: the check-in evidence
   row is written inside the request transaction before the attendance
   row exists and is linked in an after-CREATE hook — FK-safe by
   ordering, but a HANA validation run is still recommended.
4. **Optional `locationTimestamp` staleness window (15 min)** is a
   constant (`GEO_MAX_LOCATION_AGE_MINUTES`), not company configuration;
   HR policy may want it configurable later.
5. **Eligibility is per employee + fence**, not per project/assignment;
   if business wants "only project X may check in at fence Y", that is
   a scoping extension (not built this sprint).
6. Company/legal-entity isolation rides on the existing employee-level
   row security; fences link organizationally via the optional
   `Location` association but per-company isolation is not separately
   filtered (single-entity seed data).

## 6. Files changed / added

- Added: `db/geo/geo.cds`, `srv/geo/geo-service.cds`, `srv/geo/geo-service.js`,
  `srv/geo/geo-security.cds`, `srv/geo/geofence-validator.js`,
  `srv/geo/handlers/{geofence,eligibility,geofence-history}.js`,
  `db/data/ewms.db.geo-Geofence.csv`, `test/geo.test.js`,
  `docs/sprints/SPRINT-16.md`.
- Changed: `db/schema.cds`, `db/common/enums.cds` (new geo enums),
  `db/attendance/attendance.cds` (3 input-only geo fields),
  `srv/services.cds`, `srv/attendance/handlers/attendance.js`
  (geofence hook + evidence linking + check-out evaluation),
  `test/setup.js` (exposed `DELETE` helper),
  `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md`, `docs/sprints/SPRINT-15-AUDIT.md`.
- Not touched: payroll, workflow, notification, timesheet handlers;
  `SETUP.md` (no commands changed).
