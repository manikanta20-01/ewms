// ============================================================
// SPRINT 16 - GEO TRACKING & GEO-FENCING TESTS
// ------------------------------------------------------------
// Covers the Sprint 16 acceptance list (B7):
//
//   * valid/invalid coordinate ranges + radius ranges,
//   * distance calculation & boundary behavior (haversine),
//   * inactive geofences (deactivated via the bound actions),
//   * employee eligibility restriction logic,
//   * successful, bypassed and rejected geofence-restricted
//     attendance events (check-in + check-out),
//   * remote-work exception (WFH) flow,
//   * employee self-access vs cross-employee denial,
//   * administrator-only configuration changes + status actions,
//   * server-computed evidence rows (no client claim possible),
//   * duplicate events / safe retries,
//   * stale and malformed location data,
//   * history ledger + shared audit.
//
// Same harness as every other suite: one CAP test server via
// test/setup.js, CDS_ENV=test -> in-memory SQLite, mock users from
// package.json, no process.exit().
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const { GET, POST, PATCH, DELETE } = startTestHarness();

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const MGRDEPT = { auth: { username: "mgrdept", password: "" } };

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const HR_ID = "10000000-0000-0000-0000-000000000002";

const GF1 = "30000000-0000-0000-0000-000000000001"; // Head Office, r=200
const GF2 = "30000000-0000-0000-0000-000000000002"; // Electronics City, r=150

const GEO = "/odata/v4/geo";
const ATT = "/odata/v4/attendance";

// Center of GF0001 (lat 12.9716, lng 77.594566).
const IN_F1 = { latitude: 12.9716, longitude: 77.594566 }; // 0 m
const NEAR_F1 = { latitude: 12.97196, longitude: 77.594566 }; // ~40 m inside
const OUT_F1 = { latitude: 12.9806, longitude: 77.594566 }; // ~1 km outside
// Center of GF0002 (lat 12.8452, lng 77.6602).
const IN_F2 = { latitude: 12.8452, longitude: 77.6602 };
// ~7+ km from both seeded fences -> outside everything.
const FAR = { latitude: 13.0358, longitude: 77.6602 };

const ISO_NOW = () => new Date().toISOString();

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(
      code === expectedCode,
      `expected ${expectedCode} but got ${code} (${err.message})`,
    );
    if (messageMatch) assert.match(String(err.message), messageMatch);
  }
}

/** Check-in JOHN on one date with optional location evidence. */
async function checkIn(date, coords, headers = JOHN, extra = {}) {
  return POST(
    `${ATT}/Attendances`,
    {
      employee_ID: JOHN_ID,
      attendanceDate: date,
      checkIn: "09:05:00",
      ...(coords ? { ...coords, locationTimestamp: ISO_NOW() } : {}),
      ...extra,
    },
    headers,
  );
}

/** Events of one employee, read by `headers`. */
async function eventsFor(employeeId, headers) {
  const { data } = await GET(
    `${GEO}/AttendanceLocationEvents?$filter=employee_ID eq ${employeeId}`,
    headers,
  );
  return data.value;
}

// ============================================================
// 1. CONFIGURATION VALIDATION + ADMIN-ONLY CHANGES
// ============================================================
describe("Sprint 16 - geofence configuration", () => {
  test("invalid coordinates / radius are rejected with clear messages", async () => {
    // The @assert.range annotations on the entity fire BEFORE the
    // handler validation - both messages are valid rejections.
    await expectError(
      () => POST(`${GEO}/Geofences`, { name: "BadLat", latitude: 95, longitude: 77, radiusMeters: 100, effectiveFrom: "2026-01-01" }, ADMIN),
      400,
      /not in specified range \[-90, 90\]|between -90 and 90/,
    );
    await expectError(
      () => POST(`${GEO}/Geofences`, { name: "BadLng", latitude: 12, longitude: -200, radiusMeters: 100, effectiveFrom: "2026-01-01" }, ADMIN),
      400,
      /not in specified range \[-180, 180\]|between -180 and 180/,
    );
    await expectError(
      () => POST(`${GEO}/Geofences`, { name: "BadRadius", latitude: 12, longitude: 77, radiusMeters: 5, effectiveFrom: "2026-01-01" }, ADMIN),
      400,
      /not in specified range \[10, 100000\]|between 10 and 100000/,
    );
  });

  test("HRAdmin can create a fence with an auto-generated code; everyone authenticated may read fences", async () => {
    const res = await POST(
      `${GEO}/Geofences`,
      { name: `Temp Test Site ${unique()}`, latitude: 20.0, longitude: 77.0, radiusMeters: 100, effectiveFrom: "2026-01-01", description: "far away, does not collide" },
      HR,
    );
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.match(res.data.geofenceCode, /^GF\d+$/);

    const { data: visible } = await GET(`${GEO}/Geofences`, JOHN);
    assert.ok(visible.value.some((g) => g.ID === res.data.ID));
  });

  test("employees cannot create/patch fences; direct status PATCH is refused even for admins", async () => {
    await expectError(
      () => POST(`${GEO}/Geofences`, { name: "hax", latitude: 1, longitude: 1, radiusMeters: 20, effectiveFrom: "2026-01-01" }, JOHN),
      403,
    );
    await expectError(
      () => PATCH(`${GEO}/Geofences(ID=${GF1})`, { latitude: 1 }, JOHN),
      403,
    );
    await expectError(
      () => PATCH(`${GEO}/Geofences(ID=${GF1})`, { status: "Inactive" }, ADMIN),
      400,
      /actions to change geofence status/,
    );
  });

  test("deactivate + reactivate via bound actions (conditional, recorded in history)", async () => {
    const res = await POST(
      `${GEO}/Geofences`,
      { name: `Action Site ${unique()}`, latitude: 21.0, longitude: 77.0, radiusMeters: 100, effectiveFrom: "2026-01-01" },
      ADMIN,
    );
    const ID = res.data.ID;

    const off = await POST(`${GEO}/Geofences(ID=${ID})/GeoService.DeactivateGeofence`, {}, ADMIN);
    assert.ok([200, 204].includes(off.status), JSON.stringify(off.data ?? off));

    // Idempotency/race: only Active fences can be deactivated -> 409.
    await expectError(
      () => POST(`${GEO}/Geofences(ID=${ID})/GeoService.DeactivateGeofence`, {}, ADMIN),
      409,
    );

    const on = await POST(`${GEO}/Geofences(ID=${ID})/GeoService.ActivateGeofence`, {}, ADMIN);
    assert.ok([200, 204].includes(on.status), JSON.stringify(on.data ?? on));

    await expectError(
      () => POST(`${GEO}/Geofences(ID=${ID})/GeoService.DeactivateGeofence`, {}, JOHN),
      403,
    );

    const { data: hx } = await GET(`${GEO}/GeofenceHistories?$filter=geofence_ID eq ${ID}`, ADMIN);
    const actions = hx.value.map((h) => h.action);
    assert.ok(actions.includes("Created") && actions.includes("Deactivated") && actions.includes("Activated"), JSON.stringify(actions));
  });

  test("evidence + history rows are server-generated: no CREATE grant for any role", async () => {
    await expectError(
      () => POST(`${GEO}/AttendanceLocationEvents`, { employee_ID: JOHN_ID, eventType: "CheckIn", result: "Passed", latitude: 1, longitude: 1 }, JOHN),
      403,
    );
    await expectError(
      () => POST(`${GEO}/AttendanceLocationEvents`, { employee_ID: JOHN_ID, eventType: "CheckIn", result: "Passed", latitude: 1, longitude: 1 }, ADMIN),
      403,
    );
    await expectError(
      () => POST(`${GEO}/GeofenceHistories`, { geofence_ID: GF1, action: "Updated", actedOn: ISO_NOW() }, ADMIN),
      403,
    );
  });

  test("eligibility: admins manage it, employee reads own rows only", async () => {
    const res = await POST(
      `${GEO}/EmployeeLocationEligibilities`,
      { employee_ID: JOHN_ID, geofence_ID: GF1, fromDate: "2026-01-01" },
      ADMIN,
    );
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.data));

    const { data: mine } = await GET(`${GEO}/EmployeeLocationEligibilities`, JOHN);
    assert.ok(mine.value.every((e) => e.employee_ID === JOHN_ID));

    // Clean up: John must be unrestricted for the next suites.
    const del = await DELETE(`${GEO}/EmployeeLocationEligibilities(ID=${res.data.ID})`, ADMIN);
    assert.ok([200, 204].includes(del.status), JSON.stringify(del.data ?? del));
  });
});

// ============================================================
// 2. DISTANCE, BOUNDARY + EVIDENCE (John unrestricted here)
// ============================================================
describe("Sprint 16 - distance & boundary behavior", () => {
  test("exact center passes with distance ~0; ~40 m inside passes; ~1 km outside rejects", async () => {
    const ok0 = await checkIn("2026-11-02", IN_F1);
    assert.equal(ok0.status, 201, JSON.stringify(ok0.data));

    const ok40 = await checkIn("2026-11-03", NEAR_F1);
    assert.equal(ok40.status, 201, JSON.stringify(ok40.data));

    await expectError(() => checkIn("2026-11-04", OUT_F1), 400, /Location rejected/);
  });

  test("a Passed evaluation stores rounded evidence linked to the attendance row", async () => {
    const events = await eventsFor(JOHN_ID, HR);
    const center = events.find((e) => Math.abs(e.latitude - 12.9716) < 0.000001 && e.eventType === "CheckIn");
    assert.ok(center, JSON.stringify(events.map((e) => [e.eventType, e.latitude, e.distanceMeters])));
    assert.equal(center.result, "Passed");
    assert.equal(center.geofence_ID, GF1);
    assert.ok(center.distanceMeters <= 1, `distance ${center.distanceMeters}`);
    assert.ok(center.attendance_ID, "evidence must be linked to the attendance row");
  });

  test("no coordinates -> no evidence row, plain attendance unaffected", async () => {
    const res = await checkIn("2026-11-05", null);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const events = await eventsFor(JOHN_ID, HR);
    assert.ok(
      !events.some((e) => e.attendance_ID === res.data.ID),
      "no evidence row may exist for a coordinate-free check-in",
    );
  });
});

// ============================================================
// 3. ELIGIBILITY RESTRICTION + INACTIVE FENCES
// ============================================================
describe("Sprint 16 - eligibility & inactive fences", () => {
  test("restricted employee: own fence passes, other fences reject, deactivated fence bypasses", async () => {
    // John becomes RESTRICTED to GF0002 from here on.
    const elig = await POST(`${GEO}/EmployeeLocationEligibilities`, { employee_ID: JOHN_ID, geofence_ID: GF2, fromDate: "2026-01-01" }, ADMIN);
    assert.ok([200, 201].includes(elig.status), JSON.stringify(elig.data));

    // Overlapping duplicate -> 400.
    await expectError(
      () => POST(`${GEO}/EmployeeLocationEligibilities`, { employee_ID: JOHN_ID, geofence_ID: GF2, fromDate: "2026-01-01" }, ADMIN),
      400,
      /active eligibility/,
    );

    // Eligibility linkage is immutable.
    await expectError(
      () => PATCH(`${GEO}/EmployeeLocationEligibilities(ID=${elig.data.ID})`, { employee_ID: HR_ID }, ADMIN),
      400,
      /cannot be changed/,
    );

    // Deactivate GF0002 -> GF0001 is active but John is NOT eligible
    // for it -> validation bypassed, attendance succeeds.
    await POST(`${GEO}/Geofences(ID=${GF2})/GeoService.DeactivateGeofence`, {}, ADMIN);
    const bypass = await checkIn("2026-11-06", IN_F2);
    assert.equal(bypass.status, 201, JSON.stringify(bypass.data));
    const byEv = (await eventsFor(JOHN_ID, HR)).find((e) => e.attendance_ID === bypass.data.ID);
    assert.equal(byEv.result, "Bypassed");
    assert.match(byEv.reason, /not eligible/);

    // Reactivate -> GF0002 passes, GF0001 rejects again.
    await POST(`${GEO}/Geofences(ID=${GF2})/GeoService.ActivateGeofence`, {}, ADMIN);
    const good = await checkIn("2026-11-07", IN_F2);
    assert.equal(good.status, 201, JSON.stringify(good.data));
    const goodev = (await eventsFor(JOHN_ID, HR)).find((e) => e.attendance_ID === good.data.ID);
    assert.equal(goodev.result, "Passed");
    assert.equal(goodev.geofence_ID, GF2);

    await expectError(() => checkIn("2026-11-08", IN_F1), 400, /Location rejected/);
  });
});

// ============================================================
// 4. REMOTE-WORK EXCEPTION + STALENESS + MALFORMED INPUT
// ============================================================
describe("Sprint 16 - exceptions & input hygiene", () => {
  test("WorkFromHome check-in with coordinates is recorded as bypassed, not enforced", async () => {
    const res = await checkIn("2026-11-10", IN_F2, JOHN, { workLocation: "WorkFromHome" });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const ev = (await eventsFor(JOHN_ID, HR)).find((e) => e.attendance_ID === res.data.ID);
    assert.equal(ev.result, "Bypassed");
    assert.match(ev.reason, /Remote-work/);
  });

  test("stale location timestamps are rejected", async () => {
    await expectError(
      () =>
        POST(
          `${ATT}/Attendances`,
          {
            employee_ID: JOHN_ID,
            attendanceDate: "2026-11-11",
            checkIn: "09:05:00",
            ...IN_F2,
            locationTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          JOHN,
        ),
      400,
      /older than 15 minutes/,
    );
  });

  test("future-effective and expired fences are ignored on non-effective dates", async () => {
    // A fence whose effective window has NOT started yet must not
    // act as a valid fence for a check-in today. HR's employee has
    // no eligibility rows -> ALL active+effective fences apply; if
    // the future/expired fences were (wrongly) considered, they
    // would match with ~0 m and the check-in would PASS.
    const future = await POST(
      `${GEO}/Geofences`,
      { name: `Future Campus ${unique()}`, latitude: 20.0, longitude: 77.5, radiusMeters: 200, effectiveFrom: "2027-01-01" },
      ADMIN,
    );
    assert.equal(future.status, 201, JSON.stringify(future.data));

    const expired = await POST(
      `${GEO}/Geofences`,
      { name: `Old Campus ${unique()}`, latitude: 22.0, longitude: 77.5, radiusMeters: 200, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" },
      ADMIN,
    );
    assert.equal(expired.status, 201, JSON.stringify(expired.data));

    // Check-in exactly at each non-effective fence center -> the
    // evaluation must fall through to the real effective fences
    // (GF0001/GF0002, both far away) and reject.
    await expectError(
      () =>
        POST(
          `${ATT}/Attendances`,
          { employee_ID: HR_ID, attendanceDate: "2026-11-17", checkIn: "09:05:00", latitude: 20.0, longitude: 77.5, locationTimestamp: ISO_NOW() },
          HR,
        ),
      400,
      /Location rejected/,
    );
    await expectError(
      () =>
        POST(
          `${ATT}/Attendances`,
          { employee_ID: HR_ID, attendanceDate: "2026-11-18", checkIn: "09:05:00", latitude: 22.0, longitude: 77.5, locationTimestamp: ISO_NOW() },
          HR,
        ),
      400,
      /Location rejected/,
    );
  });

  test("malformed coordinates are rejected", async () => {
    await expectError(
      () =>
        POST(
          `${ATT}/Attendances`,
          { employee_ID: JOHN_ID, attendanceDate: "2026-11-12", checkIn: "09:05:00", latitude: 200, longitude: 77 },
          JOHN,
        ),
      400,
      /between -90 and 90|not in specified range \[-90, 90\]/,
    );
  });
});

// ============================================================
// 5. CHECK-OUT INTEGRATION + DUPLICATES / RETRIES
// ============================================================
describe("Sprint 16 - check-out with location, duplicates", () => {
  test("far check-out rejected; proper check-out adds a CheckOut event; retry blocked", async () => {
    const ci = await checkIn("2026-11-13", IN_F2);
    assert.equal(ci.status, 201, JSON.stringify(ci.data));

    // Far away check-out -> rejected, row stays open.
    await expectError(
      () =>
        PATCH(
          `${ATT}/Attendances(ID=${ci.data.ID})`,
          { checkOut: "18:10:00", ...FAR, locationTimestamp: ISO_NOW() },
          JOHN,
        ),
      400,
      /Location rejected/,
    );

    // Proper inside check-out passes and writes a CheckOut evidence row.
    const co = await PATCH(
      `${ATT}/Attendances(ID=${ci.data.ID})`,
      { checkOut: "18:10:00", ...IN_F2, locationTimestamp: ISO_NOW() },
      JOHN,
    );
    assert.ok([200, 204].includes(co.status), JSON.stringify(co.data ?? co));

    const rows = (await eventsFor(JOHN_ID, HR)).filter((e) => e.attendance_ID === ci.data.ID);
    assert.equal(rows.length, 2, JSON.stringify(rows.map((r) => r.eventType)));
    assert.ok(rows.some((r) => r.eventType === "CheckOut" && r.result === "Passed"));

    // Retried check-out is refused by the existing attendance guard.
    await expectError(
      () => PATCH(`${ATT}/Attendances(ID=${ci.data.ID})`, { checkOut: "19:00:00", ...IN_F2 }, JOHN),
      400,
      /already checked out/,
    );
  });

  test("geofenced check-in retried on the same date creates no second evidence row", async () => {
    const first = await checkIn("2026-11-14", IN_F2);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    await expectError(() => checkIn("2026-11-14", IN_F2), 400, /already been marked/);

    const rows = (await eventsFor(JOHN_ID, HR)).filter((e) => e.attendance_ID === first.data.ID);
    assert.equal(rows.length, 1, JSON.stringify(rows.map((r) => r.eventType)));
  });
});

// ============================================================
// 6. PRIVACY + CROSS-EMPLOYEE DENIAL + AUDIT
// ============================================================
describe("Sprint 16 - privacy, access scope, audit", () => {
  test("employees see only their own events; managers have no read; writes refused", async () => {
    // Give HR's employee one own evidence row so cross-reads are meaningful.
    const hrCheckIn = await POST(
      `${ATT}/Attendances`,
      { employee_ID: HR_ID, attendanceDate: "2026-11-15", checkIn: "09:05:00", ...IN_F2, locationTimestamp: ISO_NOW() },
      HR,
    );
    assert.equal(hrCheckIn.status, 201, JSON.stringify(hrCheckIn.data));

    const own = await eventsFor(JOHN_ID, JOHN);
    assert.ok(own.length >= 1);
    assert.ok(own.every((e) => e.employee_ID === JOHN_ID));

    const johnSeesHr = await eventsFor(HR_ID, JOHN);
    assert.equal(johnSeesHr.length, 0, "employees must not read other employees' location events");

    const all = await eventsFor(HR_ID, HR);
    assert.ok(all.some((e) => e.employee_ID === HR_ID), "HR reads the events");

    // Manager: deliberately no read on precise-location events.
    await expectError(() => GET(`${GEO}/AttendanceLocationEvents`, MGRDEPT), 403);

    // Patching an event is refused as well (no UPDATE grant).
    const someEvent = (await eventsFor(JOHN_ID, JOHN))[0];
    await expectError(
      () => PATCH(`${GEO}/AttendanceLocationEvents(ID=${someEvent.ID})`, { result: "Bypassed" }, JOHN),
      403,
    );
  });

  test("geofence config changes are audited (history ledger + shared AuditLog)", async () => {
    const upd = await PATCH(`${GEO}/Geofences(ID=${GF2})`, { description: "audited update" }, ADMIN);
    assert.ok([200, 204].includes(upd.status), JSON.stringify(upd.data ?? upd));

    const { data: hx } = await GET(`${GEO}/GeofenceHistories?$filter=geofence_ID eq ${GF2}`, ADMIN);
    assert.ok(
      hx.value.some((h) => h.action === "Updated" && /description/.test(h.changeSummary || "")),
      JSON.stringify(hx.value.map((h) => [h.action, h.changeSummary])),
    );

    // registerAuditHooks stores the SERVED entity short name (plural).
    const { data: audit } = await GET(`/odata/v4/employee/AuditLogs?$filter=entity eq 'Geofences'`, ADMIN);
    assert.ok(audit.value.length >= 1, "shared audit log must have geofence rows", );
  });
});
