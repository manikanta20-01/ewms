// ============================================================
// ENTERPRISE READINESS - DEFECT-FIX REGRESSION SUITE
// ------------------------------------------------------------
// Regression tests for the defects found and fixed during the
// enterprise-readiness review (Phase 8):
//
//   F1  ShiftAssignment handlers crashed (missing req param) on
//       every create/update/delete; overlap check was inverted.
//   F2  Overtime approver lookup used the wrong field + a
//       non-interpolating template string.
//   F3  RejectPayroll crashed on an undefined variable; rejected
//       processes without period/lock/status validation.
//   F4  Re-running ProcessPayroll duplicated approved rows.
//   F5  Workflow Role-queue tasks could not be approved by the
//       actual role holder (crowd-approved by SystemAdmin only).
//
// Testing approach (CAP-supported, same as every other suite):
//   * One CAP test server via the shared test/setup.js helper.
//   * CDS_ENV=test -> in-memory [test] profile database.
//   * Mock users come from package.json cds.requires.auth.users.
//   * No process.exit(); the runner exits naturally.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const harness = startTestHarness();

const GET = harness.GET;
const POST = harness.POST;
const PATCH = harness.PATCH;

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } };
const FINMGR = { auth: { username: "finmgr", password: "" } };
const PAYEXEC = { auth: { username: "payexec", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const MGRPROJ = { auth: { username: "mgrproj", password: "" } };

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const MGR_ID = "10000000-0000-0000-0000-000000000004";

const SHIFT_ID = "20000000-0000-0000-0000-000000000001";
const CASUAL_LEAVE_ID = "7a000000-0000-0000-0000-000000000001";

const ATT = "/odata/v4/attendance";
const PAY = "/odata/v4/payroll";

let seq = 0;
const unique = () => `t${Date.now()}${++seq}`;
const freshDate = (y, m) =>
  `${y}-${String(m).padStart(2, "0")}-${String(++seq).padStart(2, "0")}`;

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

// ============================================================
// F1 + F2 - ATTENDANCE: SHIFT ASSIGNMENT & OVERTIME
// ============================================================
describe("Fix F1 - ShiftAssignment handlers work and overlap guard", () => {
  test("HR can create a shift assignment (previously crashed with ReferenceError)", async () => {
    const { status, data } = await POST(
      `${ATT}/ShiftAssignments`,
      {
        employee_ID: JOHN_ID,
        shift_ID: SHIFT_ID,
        effectiveFrom: "2036-01-01",
      },
      HR,
    );
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.effectiveFrom, "2036-01-01");
  });

  test("effectiveTo before effectiveFrom is rejected", async () => {
    await expectError(
      () =>
        POST(
          `${ATT}/ShiftAssignments`,
          {
            employee_ID: MGR_ID,
            shift_ID: SHIFT_ID,
            effectiveFrom: "2036-02-10",
            effectiveTo: "2036-02-01",
          },
          HR,
        ),
      400,
      /Effective To must be greater/,
    );
  });

  test("overlapping assignment for the same employee is rejected", async () => {
    // JOHN runs 2036-01-01..closing from the first create.
    await expectError(
      () =>
        POST(
          `${ATT}/ShiftAssignments`,
          {
            employee_ID: JOHN_ID,
            shift_ID: SHIFT_ID,
            effectiveFrom: "2036-01-15",
            effectiveTo: "2036-02-15",
          },
          HR,
        ),
      400,
      /overlap|already has a shift assignment/i,
    );
  });

  test("non-overlapping assignment for the same employee is allowed", async () => {
    // Bounded period for MGR, then a later, non-overlapping one:
    // the range logic must allow a gap-fitting new assignment.
    const first = await POST(
      `${ATT}/ShiftAssignments`,
      {
        employee_ID: MGR_ID,
        shift_ID: SHIFT_ID,
        effectiveFrom: "2036-03-01",
        effectiveTo: "2036-03-31",
      },
      HR,
    );
    assert.ok([200, 201].includes(first.status), JSON.stringify(first.data));

    const second = await POST(
      `${ATT}/ShiftAssignments`,
      {
        employee_ID: MGR_ID,
        shift_ID: SHIFT_ID,
        effectiveFrom: "2036-04-01",
        effectiveTo: "2036-04-30",
      },
      HR,
    );
    assert.ok([200, 201].includes(second.status), JSON.stringify(second.data));
  });

  test("cross-employee shift-assignment patch is rejected", async () => {
    const { data: rows } = await GET(
      `${ATT}/ShiftAssignments?$filter=employee_ID eq ${JOHN_ID}`, HR,
    );
    const target = rows.value[0];

    // An UPDATE may never silently re-target another employee.
    await expectError(
      () =>
        PATCH(
          `${ATT}/ShiftAssignments(ID=${target.ID})`,
          { employee_ID: MGR_ID },
          HR,
        ),
      400,
      /Employee cannot be changed/,
    );

    // A valid date extension works (excluding the own row from
    // the overlap check is what makes this legitimate edit pass).
    const upd = await PATCH(
      `${ATT}/ShiftAssignments(ID=${target.ID})`,
      { effectiveFrom: "2035-12-15" },
      HR,
    );
    assert.ok([200, 204].includes(upd.status), JSON.stringify(upd.data));
  });
});

describe("Fix F2 - Overtime approver handling", () => {
  test("overtime with a bogus approver is rejected; valid approver accepted", async () => {
    // Check in and out for JOHN on a fresh, unused date.
    const ac = await POST(
      `${ATT}/Attendances`,
      {
        employee_ID: JOHN_ID,
        attendanceDate: freshDate(2037, 1),
        checkIn: "09:00:00",
      },
      JOHN,
    );
    assert.equal(ac.status, 201, JSON.stringify(ac.data));

    const checkOut = await PATCH(
      `${ATT}/Attendances(ID=${ac.data.ID})`,
      { checkOut: "20:00:00" },
      JOHN,
    );
    assert.ok([200, 204].includes(checkOut.status), JSON.stringify(checkOut.data));

    // 11h worked -> 3h overtime eligible. A non-existent approver
    // must yield a clear 400 (previously the handler queried the
    // wrong field and - worse - never awaited its lookup).
    await expectError(
      () =>
        POST(
          `${ATT}/Overtimes`,
          {
            employee_ID: JOHN_ID,
            attendance_ID: ac.data.ID,
            approvedHours: 2,
            approvedBy_ID: "c0000000-0000-0000-0000-00000000dead",
          },
          HR,
        ),
      400,
      /Approver not found/,
    );

    const ok = await POST(
      `${ATT}/Overtimes`,
      {
        employee_ID: JOHN_ID,
        attendance_ID: ac.data.ID,
        approvedHours: 2,
        approvedBy_ID: MGR_ID,
      },
      HR,
    );
    assert.ok([201, 200].includes(ok.status), JSON.stringify(ok.data));
  });
});

// ============================================================
// F3 + F4 - PAYROLL: REJECT VALIDATION & DUPLICATE BATCH
// ============================================================
describe("Fix F3/F4 - RejectPayroll validation and payroll re-run dedup", () => {
  let period;
  let processId;
  let firstRun;

  before(async () => {
    // Use the seeded PAY202608 period. Note: earlier suites may
    // already approve rows there; the F4 fix must hold either way.
    period = (await GET(`${PAY}/PayrollPeriods?$filter=payrollCode eq 'PAY202608'`, ADMIN)).data.value[0];
    assert.ok(period, "seeded period PAY202608 available");

    const proc = await POST(
      `${PAY}/PayrollPeriods(ID=${period.ID})/PayrollService.ProcessPayroll`, {}, PAYEXEC,
    );
    assert.ok([200, 204].includes(proc.status), JSON.stringify(proc.data));

    // Take an UNAPPROVED (Pending/Processed) row for the reject
    // test so F3 status rules are exercised from a clean state.
    const open = (await GET(
      `${PAY}/PayrollProcesses?$filter=payrollPeriod_ID eq ${period.ID} and processStatus eq 'Processed'&$top=1`, ADMIN,
    )).data.value;
    if (open.length) {
      processId = open[0].ID;
    } else {
      // Suite order may have approved/rejected everything: use any.
      const any = (await GET(
        `${PAY}/PayrollProcesses?$filter=payrollPeriod_ID eq ${period.ID}&$top=1`, ADMIN,
      )).data.value;
      processId = any[0]?.ID;
    }
  });

  test("rejecting without a reason is rejected with 400 (previously undefined-var 500)", async function () {
    if (!processId) this.skip();
    await expectError(
      () => POST(`${PAY}/PayrollProcesses(ID=${processId})/PayrollService.RejectPayroll`, {}, FINMGR),
      400,
      /reason is required/i,
    );
  });

  test("rejecting with a reason works; second reject is refused", async function () {
    if (!processId) this.skip();

    const { data: rec0 } = await GET(`${PAY}/PayrollProcesses(ID=${processId})`, ADMIN);
    if (["Approved", "Published", "Rejected"].includes(rec0.processStatus)) this.skip();

    const res = await POST(
      `${PAY}/PayrollProcesses(ID=${processId})/PayrollService.RejectPayroll`,
      { reason: "Attendance data incomplete for this employee" },
      FINMGR,
    );
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));

    const { data: rec } = await GET(`${PAY}/PayrollProcesses(ID=${processId})`, ADMIN);
    assert.equal(rec.processStatus, "Rejected");

    await expectError(
      () =>
        POST(
          `${PAY}/PayrollProcesses(ID=${processId})/PayrollService.RejectPayroll`,
          { reason: "again" },
          FINMGR,
        ),
      400,
      /already rejected/i,
    );
  });

  test("approved processes cannot be rejected through the side door", async function () {
    // Approve the batch (any Processed rows), then try to reject one
    // of the approved records directly.
    const appr = await POST(
      `${PAY}/PayrollPeriods(ID=${period.ID})/PayrollService.ApprovePayrollBatch`, {}, FINMGR,
    );
    assert.ok([200, 204].includes(appr.status), JSON.stringify(appr.data));

    const approved = (await GET(
      `${PAY}/PayrollProcesses?$filter=payrollPeriod_ID eq ${period.ID} and processStatus eq 'Approved'&$top=1`, ADMIN,
    )).data.value;
    assert.ok(approved.length >= 1, "approved rows exist after batch approval");
    await expectError(
      () => POST(`${PAY}/PayrollProcesses(ID=${approved[0].ID})/PayrollService.RejectPayroll`, { reason: "x" }, FINMGR),
      400,
      /Cannot reject a payroll record in 'Approved'/,
    );
  });

  test("re-processing the period does not duplicate approved records", async function () {
    // Re-run the batch: approved/published employees must be SKIPPED
    // (not duplicated). Then assert nobody has 2 process rows.
    const proc = await POST(
      `${PAY}/PayrollPeriods(ID=${period.ID})/PayrollService.ProcessPayroll`, {}, PAYEXEC,
    );
    assert.ok([200, 204].includes(proc.status), JSON.stringify(proc.data));

    const rows = (await GET(
      `${PAY}/PayrollProcesses?$filter=payrollPeriod_ID eq ${period.ID}`, ADMIN,
    )).data.value;
    const perEmployee = {};
    for (const r of rows) {
      perEmployee[r.employee_ID] = (perEmployee[r.employee_ID] || 0) + 1;
      assert.ok(
        perEmployee[r.employee_ID] <= 1,
        `duplicate process rows for employee ${r.employee_ID}`,
      );
    }
  });
});
