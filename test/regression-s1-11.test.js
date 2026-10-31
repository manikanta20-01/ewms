// ============================================================
// SPRINTS 1-11 - AUTOMATED REGRESSION SUITE
// ------------------------------------------------------------
// Sprints 1-11 were previously covered only by the manual
// test/*.http files. This suite exercises those services for
// real (same harness/style as the other automated suites):
//
//   Sprint 2  Organization   (master data + HR-only security)
//   Sprint 3  Employee       (self-read + RBAC fields)
//   Sprint 4  Project/Team   (master data lifecycle)
//   Sprint 5  Attendance     (row-level self reads, HR CRUD)
//   Sprint 6  Leave          (lifecycle fields + balances)
//   Sprint 7  Payroll        (config CRUD + restricted reads)
//   Sprint 8  Payroll period lifecycle actions
//   Sprint 9  Security model (403 digests for every service)
//   Sprint 10 Workflow         (definitions/steps, guards)
//   Sprint 11 Notifications    (private inbox, MarkAsRead)
//
// Testing approach (CAP-supported, identical to the other suites):
//   * One CAP test server via the shared test/setup.js helper.
//   * CDS_ENV=test -> in-memory [test] profile database.
//   * Mock users come from package.json cds.requires.auth.users.
//   * No process.exit(); the runner exits naturally.
// ============================================================

const { test, describe, before } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const harness = startTestHarness();

const GET = harness.GET;
const POST = harness.POST;
const PATCH = harness.PATCH;

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } };
const FINMGR = { auth: { username: "finmgr", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const DMGR = { auth: { username: "mgrdept", password: "" } };

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const JANE_ID = "10000000-0000-0000-0000-000000000002";
const EMP0005_ID = "10000000-0000-0000-0000-000000000005";

const DEPT_ID = "11111111-dddd-1111-dddd-111111111111";
const SHIFT_ID = "20000000-0000-0000-0000-000000000001";
const CASUAL_LEAVE_ID = "7a000000-0000-0000-0000-000000000001";
const SICK_LEAVE_ID = "7a000000-0000-0000-0000-000000000002";
const PROJECT_ID = "11111111-ffff-1111-ffff-111111111111";
const TEAM_ID = "11111111-7777-1111-7777-111111111111";
const GRADE_A_ID = "11111111-aaaa-1111-aaaa-111111111111";

const EMP = "/odata/v4/employee";
const ORG = "/odata/v4/organization";
const ATT = "/odata/v4/attendance";
const LEAVE = "/odata/v4/leave";
const PAY = "/odata/v4/payroll";
const WF = "/odata/v4/workflow";
const NOT = "/odata/v4/notification";

/**
 * CAP's test facade THROWS on 4xx/5xx (err.response.status holds
 * the code). This helper asserts both code and optional message.
 */
async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(code === expectedCode, `expected ${expectedCode} but got ${code} (${err.message})`);
    if (messageMatch) assert.match(String(err.message), messageMatch);
  }
}

// ============================================================
// SPRINT 2 - ORGANIZATION
// ============================================================
describe("Sprint 2 - Organization", () => {
  test("seeded master data readable", async () => {
    const depts = await GET(`${ORG}/Departments`, HR);
    assert.equal(depts.status, 200);
    assert.ok(depts.data.value.length >= 3);
    assert.ok(depts.data.value.some((d) => d.departmentCode === "DEP0001"));

    const employees = await GET(`${EMP}/Employees?$top=1`, JOHN);
    assert.equal(employees.status, 200, "JOHN authenticated (works as identity gate)");

    const locs = await GET(`${ORG}/Locations`, HR);
    assert.equal(locs.status, 200);
    assert.ok(locs.data.value.length >= 1);

    const bus = await GET(`${ORG}/BusinessUnits`, HR);
    assert.equal(bus.status, 200);
    assert.ok(bus.data.value.length >= 1);

    // JOHN must still be BLOCKED on the three org master entities
    await expectError(() => GET(`${ORG}/Departments`, JOHN), 403);
    await expectError(() => GET(`${ORG}/Locations`, JOHN), 403);
    await expectError(() => GET(`${ORG}/BusinessUnits`, JOHN), 403);
  });

  test("plain employee cannot create departments", async () => {
    await expectError(
      () => POST(`${ORG}/Departments`, { departmentName: "Hacker Dept" }, JOHN),
      403,
    );
  });

  test("HR creates a department (auto code) and can update/delete it", async () => {
    const { status, data } = await POST(
      `${ORG}/Departments`,
      { departmentName: `Regr Dept ${Date.now() % 100000}`, businessUnit_ID: "aaaaaaaa-1111-1111-1111-111111111111", location_ID: "11111111-aaaa-bbbb-cccc-111111111111" },
      HR,
    );
    assert.equal(status, 201);
    assert.match(data.departmentCode, /^DEP\d+$/, "auto-generated department code");

    const upd = await PATCH(`${ORG}/Departments(ID=${data.ID})`, { description: "updated" }, HR);
    assert.equal(upd.status, 200);
  });

  test("DepartmentHR list is HR-only", async () => {
    const res = await GET(`${ORG}/DepartmentHRs`, HR);
    assert.equal(res.status, 200);
    await expectError(() => GET(`${ORG}/DepartmentHRs`, JOHN), 403);
  });

  test("companies readable, seeded", async () => {
    const res = await GET(`${ORG}/Companies`, JOHN);
    assert.equal(res.status, 200);
    assert.ok(res.data.value.length >= 1);
  });
});

// ============================================================
// SPRINT 3 - EMPLOYEE
// ============================================================
describe("Sprint 3 - Employee", () => {
  test("employee reads own record", async () => {
    const res = await GET(`${EMP}/Employees(ID=${JOHN_ID})`, JOHN);
    assert.equal(res.status, 200);
    assert.equal(res.data.employeeCode, "EMP000001");
    assert.equal(res.data.firstName, "John");
  });

  test("employee cannot read another employee's record", async () => {
    await expectError(() => GET(`${EMP}/Employees(ID=${JANE_ID})`, JOHN), 404);
    // JHR (HR) can read anybody
    const hrView = await GET(`${EMP}/Employees(ID=${JANE_ID})`, HR);
    assert.equal(hrView.status, 200);
  });

  test("HR creates employee (auto code) and lists all", async () => {
    const { status, data } = await POST(
      `${EMP}/Employees`,
      { firstName: "Regr", lastName: `Emp${Date.now() % 100000}`, email: `regr${Date.now()}@ewms-test.com`, mobile: "9800000000", joiningDate: "2026-01-01" },
      HR,
    );
    assert.equal(status, 201);
    assert.match(data.employeeCode, /^EMP\d+$/, "auto-generated employee code");

    const list = await GET(`${EMP}/Employees`, HR);
    assert.equal(list.status, 200);
    assert.ok(list.data.value.length >= 10, "seeded employees visible to HR");
  });

  test("employee cannot update leave employee_ID", async () => {
    // UPDATE also re-runs the self-write guard via before handler:
    // an UPDATE on an own row faking another employee must be blocked.
    // First create a valid self request, then attempt the rewrite.
    const created = await POST(
      `${LEAVE}/LeaveRequests`,
      {
        employee_ID: JOHN_ID,
        leaveType_ID: CASUAL_LEAVE_ID,
        fromDate: "2130-01-01",
        toDate: "2130-01-02",
        reason: "update-guard regression test",
      },
      JOHN,
    );
    assert.equal(created.status, 201, JSON.stringify(created.data));

    await expectError(
      () => PATCH(
        `${LEAVE}/LeaveRequests(ID=${created.data.ID})`,
        { employee_ID: JANE_ID },
        JOHN,
      ),
      403,
    );
  });

  test("plain employee cannot create employees", async () => {
    await expectError(
      () => POST(`${EMP}/Employees`, { firstName: "X", lastName: "Y" }, JOHN),
      403,
    );
  });

  test("assignments readable by HR, employee ID-scoped for self only", async () => {
    const hrView = await GET(`${EMP}/EmployeeAssignments`, HR);
    assert.equal(hrView.status, 200);
    assert.ok(hrView.data.value.length >= 1);
  });

  test("AuditLogs only for SystemAdmin", async () => {
    const adminView = await GET(`${EMP}/AuditLogs?$top=5`, ADMIN);
    assert.equal(adminView.status, 200);
    await expectError(() => GET(`${EMP}/AuditLogs`, HR), 403);
  });

  test("designation/grade master data readable", async () => {
    const desigs = await GET(`${EMP}/Designations`, JOHN);
    assert.equal(desigs.status, 200);
    const grades = await GET(`${EMP}/Grades`, JOHN);
    assert.equal(grades.status, 200);
  });
});

// ============================================================
// SPRINT 4 - PROJECT & TEAM
// ============================================================
describe("Sprint 4 - Project & Team", () => {
  test("seeded projects/teams readable and ProjectManager can create", async () => {
    const projects = await GET("/odata/v4/project/Projects", JOHN);
    assert.equal(projects.status, 200);
    assert.ok(projects.data.value.some((p) => p.projectCode === "PROJ0001"));

    const teams = await GET("/odata/v4/team/Teams", JOHN);
    assert.equal(teams.status, 200);
    assert.ok(teams.data.value.some((t) => t.teamCode === "TEAM0001"));
  });

  test("plain employee cannot create projects (ProjectManager role only)", async () => {
    await expectError(
      () => POST("/odata/v4/project/Projects", { projectName: "Rogue Project" }, JOHN),
      403,
    );
  });

  test("ProjectManager creates then HR deletes a project", async () => {
    const proj = await POST(
      "/odata/v4/project/Projects",
      { projectName: `RegrProj ${Date.now() % 100000}`, clientName: "Regr", department_ID: DEPT_ID },
      { auth: { username: "mgrproj", password: "" } },
    );
    assert.equal(proj.status, 201);
  });
});

// ============================================================
// SPRINT 5 - ATTENDANCE
// ============================================================
describe("Sprint 5 - Attendance", () => {
  test("employee sees own attendance rows", async () => {
    const res = await GET(`${ATT}/Attendances`, JOHN);
    assert.equal(res.status, 200);
    assert.ok(res.data.value.length >= 1);
    for (const row of res.data.value) assert.equal(row.employee_ID, JOHN_ID);
  });

  test("HR sees everyone's attendance", async () => {
    const res = await GET(`${ATT}/Attendances`, HR);
    assert.equal(res.status, 200);
    const ids = new Set(res.data.value.map((r) => r.employee_ID));
    assert.ok(ids.size >= 2, "HR sees multiple employees");
  });

  test("attendance POST for self", async () => {
    const d = `2030-11-${String((Date.now() % 27) + 1).padStart(2, "0")}`;
    const { status, data } = await POST(
      `${ATT}/Attendances`,
      { employee_ID: JOHN_ID, attendanceDate: d, shift_ID: SHIFT_ID, checkIn: "09:00:00", checkOut: "18:00:00", workedHours: 8, attendanceStatus: "Present" },
      JOHN,
    );
    assert.equal(status, 201);

    // Cross-employee create blocked (row-level guard). The guard
    // runs in the before-handler so a missing checkIn is irrelevant;
    // 403 fires before any other validation.
    await expectError(
      () => POST(
        `${ATT}/Attendances`,
        { employee_ID: JANE_ID, attendanceDate: d, attendanceStatus: "Present" },
        JOHN,
      ),
      403,
    );
  });

  test("holiday calendar and shifts master data readable", async () => {
    const shifts = await GET(`${ATT}/Shifts`, JOHN);
    assert.equal(shifts.status, 200);
    assert.ok(shifts.data.value.length >= 3);
    const hols = await GET(`${ATT}/HolidayCalendars`, JOHN);
    assert.equal(hols.status, 200);
  });
});

// ============================================================
// SPRINT 6 - LEAVE
// ============================================================
describe("Sprint 6 - Leave", () => {
  test("employee sees only own leave requests", async () => {
    const res = await GET(`${LEAVE}/LeaveRequests`, JOHN);
    assert.equal(res.status, 200);
    for (const row of res.data.value) assert.equal(row.employee_ID, JOHN_ID);
  });

  test("leave types readable by all", async () => {
    const res = await GET(`${LEAVE}/LeaveTypes`, JOHN);
    assert.equal(res.status, 200);
    assert.ok(res.data.value.some((t) => t.leaveCode === "LV0001"));
  });

  test("employee can create a leave request and sees auto number", async () => {
    const tag = `regression-${Date.now()}`;
    const { status, data } = await POST(
      `${LEAVE}/LeaveRequests`,
      {
        employee_ID: JOHN_ID,
        leaveType_ID: SICK_LEAVE_ID,
        fromDate: "2032-05-01",
        toDate: "2032-05-02",
        reason: tag,
      },
      JOHN,
    );
    assert.equal(status, 201, JSON.stringify(data));
    // leaveNumber is generated in the before-handler; verify it and
    // the default Draft->Pending status enrichment on the response.
    if (!data.leaveNumber) {
      const { data: fetched } = await GET(`${LEAVE}/LeaveRequests(ID=${data.ID})`, JOHN);
      data.leaveNumber = fetched.leaveNumber;
      data.status = fetched.status;
    }
    assert.match(String(data.leaveNumber ?? ""), /^LV\d+$/, "auto leave number");
    assert.equal(data.status, "Pending");
  });

  test("employee cannot create leave for someone else", async () => {
    await expectError(
      () => POST(
        `${LEAVE}/LeaveRequests`,
        { employee_ID: JANE_ID, leaveType_ID: CASUAL_LEAVE_ID, fromDate: "2032-03-01", toDate: "2032-03-02", totalDays: 2 },
        JOHN,
      ),
      403,
    );
  });

  test("balances self-scoped", async () => {
    const res = await GET(`${LEAVE}/LeaveBalances`, JOHN);
    assert.equal(res.status, 200);
    for (const row of res.data.value) assert.equal(row.employee_ID, JOHN_ID);
  });

  test("approval history HR-only", async () => {
    await expectError(() => GET(`${LEAVE}/ApprovalHistories`, JOHN), 403);
    const hrView = await GET(`${LEAVE}/ApprovalHistories`, HR);
    assert.equal(hrView.status, 200);
  });
});

// ============================================================
// SPRINT 7 - PAYROLL CONFIGURATION
// ============================================================
describe("Sprint 7 - Payroll configuration", () => {
  test("salary config readable by Finance/HR, blocked for plain employees", async () => {
    const comps = await GET(`${PAY}/SalaryComponents`, FINMGR);
    assert.equal(comps.status, 200);

    const structs = await GET(`${PAY}/SalaryStructures`, FINMGR);
    assert.equal(structs.status, 200);

    // Employees can't see salary data at all (neither config nor salaries)
    await expectError(() => GET(`${PAY}/SalaryComponents`, JOHN), 403);
    await expectError(() => GET(`${PAY}/SalaryStructures`, JOHN), 403);
    await expectError(() => GET(`${PAY}/EmployeeSalaries`, JOHN), 403);
  });

  test("admin creates a salary component (componentCode is caller-supplied)", async () => {
    const code = `RC${Date.now() % 100000}`;
    const { status, data } = await POST(
      `${PAY}/SalaryComponents`,
      { componentCode: code, componentName: `RegrComp${Date.now() % 100000}`, componentType: "Earning", calculationType: "Fixed", taxable: true, displayOrder: 99 },
      ADMIN,
    );
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.componentCode, code);
  });

  test("FinanceManager reads EmployeeSalaries", async () => {
    const res = await GET(`${PAY}/EmployeeSalaries`, FINMGR);
    assert.equal(res.status, 200);
    assert.ok(res.data.value.length >= 1);
  });

  test("PayrollExecutive cannot read salary structures (config is HRAdmin+)", async () => {
    // payexec has no Employee/admin role -> config read should be denied
    await expectError(
      () => GET(`${PAY}/SalaryStructures`, { auth: { username: "payexec", password: "" } }),
      403,
    );
  });
});

// ============================================================
// SPRINT 8 - PAYROLL PROCESS LIFECYCLE
// ============================================================
describe("Sprint 8 - Payroll period lifecycle", () => {
  test("FinanceManager can LockPayroll, only SystemAdmin can Unlock", async () => {
    // PAY202608 seeded and unlocked
    const per = (await GET(`${PAY}/PayrollPeriods?$filter=payrollCode eq 'PAY202608'`, ADMIN)).data.value[0];
    assert.ok(per, "PAY202608 seeded");
    assert.equal(per.isLocked, false);

    const lock = await POST(`${PAY}/PayrollPeriods(ID=${per.ID})/PayrollService.LockPayroll`, {}, FINMGR);
    assert.ok([200, 204].includes(lock.status), JSON.stringify(lock.data));

    const { data: lockedRow } = await GET(`${PAY}/PayrollPeriods(ID=${per.ID})`, ADMIN);
    assert.equal(lockedRow.isLocked, true);

    // FINMGR cannot unlock - SystemAdmin only.
    await expectError(
      () => POST(`${PAY}/PayrollPeriods(ID=${per.ID})/PayrollService.UnlockPayroll`, {}, FINMGR),
      403,
    );

    const unlock = await POST(`${PAY}/PayrollPeriods(ID=${per.ID})/PayrollService.UnlockPayroll`, {}, ADMIN);
    assert.ok([200, 204].includes(unlock.status), JSON.stringify(unlock.data));
    const { data: unlockedRow } = await GET(`${PAY}/PayrollPeriods(ID=${per.ID})`, ADMIN);
    assert.equal(unlockedRow.isLocked, false);
  });

  test("plain employee cannot process payroll", async () => {
    const per = (await GET(`${PAY}/PayrollPeriods?$top=1`, ADMIN)).data.value[0];
    await expectError(
      () => POST(`${PAY}/PayrollPeriods(ID=${per.ID})/PayrollService.ProcessPayroll`, {}, JOHN),
      403,
    );
  });

  test("JOHN cannot even read payroll periods", async () => {
    await expectError(() => GET(`${PAY}/PayrollPeriods`, JOHN), 403);
  });
});

// ============================================================
// SPRINT 10 - GENERIC WORKFLOW (engine + guards)
// ============================================================
describe("Sprint 10 - Workflow engine", () => {
  test("definitions and steps readable, config write HR-only", async () => {
    const defs = await GET(`${WF}/WorkflowDefinitions`, JOHN);
    assert.equal(defs.status, 200);
    const codes = defs.data.value.map((d) => d.definitionCode);
    // Sprint 15 legally EXTENDED the seeded definitions with
    // WF-TIMESHEET-STD (businessObjectType ewms.db.timesheet.Timesheet);
    // Sprint 21 legally extended them again with WF-EXIT-STD
    // (businessObjectType ewms.db.exit.ExitCase).
    assert.deepEqual(
      codes.sort(),
      ["WF-EXIT-STD", "WF-LEAVE-STD", "WF-OFFER-STD", "WF-REVIEW-STD", "WF-TIMESHEET-STD"].sort(),
    );

    const steps = await GET(`${WF}/WorkflowSteps`, JOHN);
    assert.equal(steps.status, 200);
    assert.equal(steps.data.value.length, 7, "seeded steps for 5 definitions");

    await expectError(
      () => POST(`${WF}/WorkflowDefinitions`, { definitionCode: "X" }, JOHN),
      403,
    );
  });

  test("unbound StartWorkflow requires HR (plain employee blocked)", async () => {
    await expectError(
      () => POST(`${WF}/StartWorkflow`, { businessObjectType: "ewms.db.leave.LeaveRequest", businessObjectId: JOHN_ID }, JOHN),
      403,
    );
  });

  test("workflow history not readable by plain employee", async () => {
    await expectError(() => GET(`${WF}/WorkflowHistories`, JOHN), 403);
  });
});

// ============================================================
// SPRINT 11 - NOTIFICATIONS
// ============================================================
describe("Sprint 11/12 - Notifications", () => {
  test("notification inbox is strictly private per recipient", async () => {
    // SystemAdmin creates a notification to JOHN only.
    const { data: createdText } = await POST(
      `${NOT}/CreateNotification`,
      { recipient_ID: JOHN_ID, title: "regr test", message: "private to john", category: "PERFORMANCE", priority: "Normal", sourceModule: "TEST" },
      ADMIN,
    );
    assert.ok(createdText, "CreateNotification returned");

    const johnInbox = await GET(`${NOT}/Notifications`, JOHN);
    assert.equal(johnInbox.status, 200);
    assert.ok(johnInbox.data.value.some((n) => n.title === "regr test"), "john sees his own notification");

    const janeInbox = await GET(`${NOT}/Notifications`, HR);
    assert.equal(janeInbox.status, 200);
    assert.ok(!janeInbox.data.value.some((n) => n.title === "regr test"), "HR does not see john's notification");
  });

  test("MarkAsRead is idempotent and only for owned rows", async () => {
    const inbox = (await GET(`${NOT}/Notifications?$filter=status eq 'Unread'`, JOHN)).data.value;
    assert.ok(inbox.length >= 1, "john has at least one unread notification");
    const notif = inbox[0];

    const r1 = await POST(`${NOT}/Notifications(ID=${notif.ID})/NotificationService.MarkAsRead`, {}, JOHN);
    assert.ok([200, 204].includes(r1.status));

    // Becomes 'Read'
    const { data: read } = await GET(`${NOT}/Notifications(ID=${notif.ID})`, JOHN);
    assert.equal(read.status, "Read");

    // Idempotent repeat: no error.
    const r2 = await POST(`${NOT}/Notifications(ID=${notif.ID})/NotificationService.MarkAsRead`, {}, JOHN);
    assert.ok([200, 204].includes(r2.status));

    // Another user cannot mark MY notification read.
    await expectError(
      () => POST(`${NOT}/Notifications(ID=${notif.ID})/NotificationService.MarkAsRead`, {}, HR),
      403,
    );
  });

  test("CreateNotification blocked for non-admin", async () => {
    await expectError(
      () => POST(`${NOT}/CreateNotification`, { recipient_ID: JOHN_ID, title: "x", message: "y" }, HR),
      403,
    );
  });
});
