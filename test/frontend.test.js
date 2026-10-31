const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..", "app");
const WEBAPP = path.join(APP, "EWMS", "webapp");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

test("Sprint 26 frontend foundation — shell files exist", () => {
  for (const rel of [
    "index.html",
    "manifest.json",
    "Component.js",
    "i18n/i18n.properties",
    "model/Config.js",
    "model/Backend.js",
    "view/Main.view.xml",
    "view/Home.view.xml",
    "view/EmployeeList.view.xml",
    "view/EmployeeDetail.view.xml",
    "controller/Main.controller.js",
    "controller/Home.controller.js",
    "controller/EmployeeList.controller.js",
    "controller/EmployeeDetail.controller.js",
  ]) {
    assert.ok(fs.existsSync(path.join(WEBAPP, rel)), `missing ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(APP, "index.html")), "app start page missing");
});

test("manifest is valid JSON with the working route set", () => {
  const m = JSON.parse(read(path.join(WEBAPP, "manifest.json")));
  assert.equal(m["sap.app"].id, "ewms.EWMS");
  const routes = m["sap.ui5"].routing.routes;
  // Sprint 26 set the three-shell routes; Sprint 27 adds the org,
  // project and team list/detail route pairs on the same shell;
  // Sprint 28 adds the attendance-domain routes.
  assert.deepEqual(
    routes.map((r) => r.name).sort(),
    [
      "employeeDetail", "employees", "home",
      "org", "orgDetail",
      "projectDetail", "projects",
      "teamDetail", "teams",
      "attendance", "attendanceDetail",
      "leave", "leaveDetail",
      "timesheets", "timesheetDetail",
      "shifts", "geo",
    ].sort()
  );
  for (const r of routes) {
    assert.ok(m["sap.ui5"].routing.targets[r.target], `route ${r.name} has no target`);
  }
  assert.equal(
    m["sap.ui5"].routing.targets.employeeDetail.controlAggregation,
    "endColumnPages"
  );
});

test("service configuration uses relative same-origin paths only (no hardcoded hosts)", () => {
  const files = [
    "model/Config.js",
    "model/Backend.js",
    "manifest.json",
    "Component.js",
  ].map((rel) => path.join(WEBAPP, rel));
  const banned = /localhost:\d+|127\.0\.0\.1|https?:\/\/(?!sapui5\.hana\.ondemand\.com)/;
  for (const f of files) {
    const src = read(f);
    const m = src.match(banned);
    assert.equal(m, null, `hardcoded host in ${path.basename(f)}: ${m && m[0]}`);
  }
  const config = read(path.join(WEBAPP, "model", "Config.js"));
  assert.ok(config.includes("/odata/v4/employee/"), "employee service path must match the actual CAP path");
});

test("UI5 bootstrap pins an explicit SAPUI5 version and required libraries", () => {
  const html = read(path.join(WEBAPP, "index.html"));
  const m = html.match(/sapui5\.hana\.ondemand\.com\/(\d+\.\d+\.\d+)\/resources\/sap-ui-core\.js/);
  assert.ok(m, "exact SAPUI5 runtime version must be pinned (no floating URL)");
  for (const lib of ["sap.m", "sap.f"]) {
    assert.ok(html.includes(`"sap.ui.libs"` ) || html.includes(lib), `bootstrap must declare ${lib}`);
  }
  assert.ok(html.includes('data-sap-ui-theme="sap_horizon"'), "Fiori horizon theme");
});

test("no silent mock-data fallback in the data layer", () => {
  const backend = read(path.join(WEBAPP, "model", "Backend.js"));
  assert.ok(!/mockData|MOCK_DATA|fallbackRows|hardcoded rows/i.test(backend),
    "Backend.js must not ship any fake business rows");
  assert.ok(/reject\(new Error/.test(backend),
    "failed OData calls must reject with an error, not resolve with substitutions");
  assert.ok(!/rows:\s*\[\s*\{/.test(backend),
    "read helpers must not contain inline fake row literals as a fallback");
});

test("example data is not seeded inside the shell views", () => {
  for (const rel of ["view/Home.view.xml", "view/EmployeeList.view.xml", "view/EmployeeDetail.view.xml"]) {
    const xml = read(path.join(WEBAPP, rel));
    assert.ok(!/John|Jane|Doe|Smith/.test(xml), `${rel} must not contain fake business rows`);
  }
});

// ============================================================
// Sprint 28 - attendance domain screens
// ============================================================
test("Sprint 28 screens exist and are registered", () => {
  for (const rel of [
    "view/AttendanceList.view.xml", "view/AttendanceDetail.view.xml", "view/CheckInDialog.fragment.xml",
    "view/LeaveList.view.xml", "view/LeaveDetail.view.xml", "view/ApplyLeaveDialog.fragment.xml",
    "view/TimesheetList.view.xml", "view/TimesheetDetail.view.xml",
    "view/CreateTimesheetDialog.fragment.xml", "view/AddTimesheetItemDialog.fragment.xml",
    "view/CommentsDialog.fragment.xml", "view/TimesheetHeader.fragment.xml",
    "view/Shifts.view.xml", "view/GeoEvidence.view.xml",
    "controller/AttendanceList.controller.js", "controller/AttendanceDetail.controller.js",
    "controller/LeaveList.controller.js", "controller/LeaveDetail.controller.js",
    "controller/TimesheetList.controller.js", "controller/TimesheetDetail.controller.js",
    "controller/Shifts.controller.js", "controller/GeoEvidence.controller.js",
  ]) {
    assert.ok(fs.existsSync(path.join(WEBAPP, rel)), `missing ${rel}`);
  }
});

test("Sprint 28 data layer exposes only real service surfaces", () => {
  const backend = read(path.join(WEBAPP, "model", "Backend.js"));
  // Real entity projections from srv/*.cds (names matter: they hit
  // the actual OData endpoints). No invented entities allowed.
  for (const entity of ["Attendances", "LeaveRequests", "LeaveTypes", "LeaveBalances",
    "LeaveApprovals", "ApprovalHistories", "Timesheets", "TimesheetItems",
    "TimesheetHistories", "Shifts", "ShiftAssignments", "WorkSchedules",
    "Holidays", "Geofences", "AttendanceLocationEvents"]) {
    assert.ok(backend.includes(entity), `Backend.js must reference the real entity ${entity}`);
  }
  // Real bound timesheet action helper (POST /Timesheets(<id>)/<Action>).
  assert.ok(/timesheetAction:\s*function/.test(backend), "bound timesheet action helper required");
});

test("timesheet UI drives transitions through backend actions, never direct status PATCHes", () => {
  const detail = read(path.join(WEBAPP, "controller", "TimesheetDetail.controller.js"));
  assert.ok(detail.includes("timesheetAction"), "detail must call the bound actions");
  for (const action of ["Submit", "StartReview", "Approve", "Reject", "Withdraw", "Cancel", "Reopen"]) {
    assert.ok(detail.includes(`"${action}"`) || detail.includes(`'${action}'`),
      `lifecycle action ${action} must be wired to its real backend action`);
  }
  const list = read(path.join(WEBAPP, "controller", "TimesheetList.controller.js"));
  assert.ok(!/status:\s*['"]/.test(list.replace(/statusText[^,]*/g, "")),
    "the list view must not write status fields");
});

test("timesheet reject requires a reason in the UI too (backend rule mirrored, not bypassed)", () => {
  const detail = read(path.join(WEBAPP, "controller", "TimesheetDetail.controller.js"));
  assert.ok(/A reason is required when rejecting/.test(detail));
});

test("geo screen is read-only and free of synthetic location data", () => {
  const view = read(path.join(WEBAPP, "view", "GeoEvidence.view.xml"));
  const ctl = read(path.join(WEBAPP, "controller", "GeoEvidence.controller.js"));
  assert.ok(!/getCurrentPosition|watchPosition/.test(ctl),
    "evidence view must never request browser geolocation");
  assert.ok(!/latitude|longitude/.test(ctl.replace(/\/\*[^*]*\*\//g, "").replace(/\/\/[^\n]*/g, "")),
    "controller must not fabricate coordinates");
  const backend = read(path.join(WEBAPP, "model", "Backend.js"));
  // No write-helper for location evidence / geofences anywhere: the
  // geofence validator owns those rows.
  for (const banned of ["postGeofences", "createGeofence", "postLocationEvents", "createLocationEvent"]) {
    assert.ok(!backend.includes(banned), `no write surface for ${banned}`);
  }
});

test("attendance check-in dialog requests location only on explicit opt-in", () => {
  const ctl = read(path.join(WEBAPP, "controller", "AttendanceList.controller.js"));
  assert.ok(/useLocation/.test(ctl), "location capture must be user-opted-in");
  // The opt-out path sends NO coordinates (no zero/0,0 default).  It
  // must not attach lat/lng unless getCurrentPosition succeeded.
  const plainPayload = ctl.match(/finish\(\{[^}]*\}\);\s*return;/);
  assert.ok(plainPayload, "opt-out check-in payload must exist");
  assert.ok(!/latitude/.test(plainPayload[0]), "opt-out payload must not contain coordinates");
});

test("every Sprint 28 control is wired (no dangling route/nav references)", () => {
  const manifest = JSON.parse(read(path.join(WEBAPP, "manifest.json")));
  const routeNames = new Set(manifest["sap.ui5"].routing.routes.map((r) => r.name));
  for (const ctl of ["AttendanceList", "LeaveList", "TimesheetList", "Shifts", "GeoEvidence"]) {
    const src = read(path.join(WEBAPP, "controller", `${ctl}.controller.js`));
    for (const m of src.matchAll(/navTo\("([a-zA-Z]+)"/g)) {
      assert.ok(routeNames.has(m[1]), `${ctl} navigates to unknown route ${m[1]}`);
    }
    for (const m of src.matchAll(/getRoute\("([a-zA-Z]+)"\)/g)) {
      assert.ok(routeNames.has(m[1]), `${ctl} subscribes to unknown route ${m[1]}`);
    }
  }
});

test("Sprint 28 fragments reference the declared controller surface", () => {
  // Dialogs must resolve against a controller that exists in the
  // register (sap.m Dialogs take the invoking controller's handlers).
  const pairs = [
    ["view/CheckInDialog.fragment.xml", ["onCloseCheckIn", "onConfirmCheckIn"]],
    ["view/ApplyLeaveDialog.fragment.xml", ["onCloseApply", "onConfirmApply"]],
    ["view/CreateTimesheetDialog.fragment.xml", ["onCancelCreate", "onSaveCreate"]],
    ["view/AddTimesheetItemDialog.fragment.xml", ["onItemCancel", "onItemSave"]],
    ["view/CommentsDialog.fragment.xml", ["onCommentsCancel", "onCommentsConfirm"]],
  ];
  for (const [fragment, handlers] of pairs) {
    const src = read(path.join(WEBAPP, fragment));
    for (const h of handlers) {
      // Every press handler named in the fragment must exist in one
      // of the two feature controllers for that screen.
      const inTimesheet   = read(path.join(WEBAPP, "controller", "TimesheetList.controller.js")).includes(h)
        || read(path.join(WEBAPP, "controller", "TimesheetDetail.controller.js")).includes(h);
      const inAttendance  = read(path.join(WEBAPP, "controller", "AttendanceList.controller.js")).includes(h);
      const inLeave       = read(path.join(WEBAPP, "controller", "LeaveList.controller.js")).includes(h);
      assert.ok(inTimesheet || inAttendance || inLeave,
        `${fragment}: handler ${h} not found in any controller`);
    }
  }
});
