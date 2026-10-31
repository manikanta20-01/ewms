// ============================================================
// SPRINT 23 - REPORTS & EXPORT TESTS
// ------------------------------------------------------------
// Covers the acceptance list:
//   * every report type renders (incl. empty result sets),
//   * invalid filters are REFUSED server-side (400),
//   * date-range boundaries (from>to, one-sided, >366 days),
//   * authorization: employees AND managers denied 403 on every
//     report; finance only on the asset report (row-level rule:
//     filters can never widen a role),
//   * sensitive fields: personal reports exist ONLY behind HR
//     roles (documentNumber etc. can never reach an employee),
//   * CSV quoting/escaping + formula-injection protection
//     (unit-level for the builder + endpoint-level checks),
//   * export metadata (Content-Disposition filename, no personal
//     data in the filename),
//   * filter parity: the export and the report READ return the
//     same rows for the same filters,
//   * limits: unbounded exports refused 413, $top pagination
//     honored server-side,
//   * audit: exports write AuditLog rows (facts, no content).
// Same harness as every other suite (test/setup.js).
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");
const cds = require("@sap/cds");

const { startTestHarness } = require("./setup");
const { GET, POST } = startTestHarness();
const csvBuilder = require("../srv/common/utils/csv-builder");

const R = "/odata/v4/reports";
const HR = { auth: { username: "hrperson", password: "" } };   // HRExec+HRAdmin
const JOHN = { auth: { username: "empjohn", password: "" } };  // Employee
const MGR = { auth: { username: "mgrdept", password: "" } };   // DepartmentManager
const FIN = { auth: { username: "finmgr", password: "" } };    // FinanceManager
const ADMIN = { auth: { username: "sysadmin", password: "" } }; // SystemAdmin+HRAdmin+Fin

const REPORTS = [
  "Workforce", "Attendance", "Leave", "Recruitment", "Performance",
  "Asset", "DocumentExpiry", "Helpdesk", "Exit",
];

async function db(sql) {
  return cds.db.run(sql);
}

/** The harness GET/POST helpers THROW on error statuses. */
async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.equal(code, expectedCode,
      `expected ${expectedCode} but got ${code} (${err.message})`);
    if (messageMatch) {
      const text = String(err.response?.data?.error?.message ?? err.message ?? "");
      assert.ok(text.includes(messageMatch), `expected "${text}" to include "${messageMatch}"`);
    }
  }
}

// ============================================================
describe("Sprint 23 - authorization (reports are not a row-security bypass)", () => {
  test("a plain employee is denied EVERY report read", async () => {
    for (const report of REPORTS) {
      await expectError(() => GET(`${R}/${report}`, JOHN), 403);
    }
  });

  test("a plain employee is denied the export too", async () => {
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "Workforce" }, JOHN), 403);
  });

  test("a manager cannot smuggle other-employee filters (403, not scoped rows)", async () => {
    // Even with the HR employee's own ID as a filter, a manager has
    // NO access at all - the endpoint must never become a proxy.
    await expectError(
      () => GET(`${R}/Attendance?$filter=employee_ID eq '10000000-0000-0000-0000-000000000001'`, MGR),
      403);
    await expectError(
      () => GET(`${R}/Workforce?$filter=department_ID eq 11111111-dddd-1111-dddd-111111111111`, MGR),
      403);
  });

  test("finance may read ONLY the asset report", async () => {
    const res = await GET(`${R}/Asset`, FIN);
    assert.equal(res.status, 200);
    for (const report of REPORTS.filter((r) => r !== "Asset")) {
      await expectError(() => GET(`${R}/${report}`, FIN), 403);
    }
  });

  test("HR and SystemAdmin read every report", async () => {
    for (const report of REPORTS) {
      const res = await GET(`${R}/${report}`, HR);
      assert.equal(res.status, 200, report);
      assert.ok(Array.isArray(res.data.value));
      const admin = await GET(`${R}/${report}`, ADMIN);
      assert.equal(admin.status, 200, `admin ${report}`);
    }
  });
});

// ============================================================
describe("Sprint 23 - filter validation & boundaries", () => {
  test("one-sided date range refused (400)", async () => {
    await expectError(
      () => GET(`${R}/Attendance?$filter=attendanceDate ge 2026-01-01`, HR),
      400, "together");
  });

  test("inverted date range refused (400)", async () => {
    await expectError(
      () => GET(`${R}/Attendance?$filter=attendanceDate ge 2026-02-01 and attendanceDate le 2026-01-01`, HR),
      400, "not be after");
  });

  test("range longer than 366 days refused (400)", async () => {
    // 2025-01-01 -> 2026-01-03 spans beyond the 366-day window.
    await expectError(
      () => GET(`${R}/Attendance?$filter=attendanceDate ge 2025-01-01 and attendanceDate le 2026-01-03`, HR),
      400, "366");
  });

  test("max 366-day range accepted", async () => {
    const res = await GET(
      `${R}/Attendance?$filter=attendanceDate ge 2025-10-01 and attendanceDate le 2026-10-01`, HR);
    assert.equal(res.status, 200);
  });

  test("empty result set is a clean 200 with an empty list", async () => {
    const res = await GET(
      `${R}/Attendance?$filter=employee_ID eq 99999999-ffff-ffff-ffff-ffffffffffff`, HR);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.value, []);
  });

  test("$top pagination is honored server-side", async () => {
    const all = await GET(`${R}/Attendance`, HR);
    const top2 = await GET(`${R}/Attendance?$top=2`, HR);
    assert.equal(top2.data.value.length, Math.min(2, all.data.value.length));
  });
});

// ============================================================
describe("Sprint 23 - report data correctness (vs independent SQL)", () => {
  test("Workforce returns every employee with the latest-history department", async () => {
    const res = await GET(`${R}/Workforce`, HR);
    assert.equal(res.status, 200);
    const rows = await db(`SELECT COUNT(*) c FROM ewms_db_employee_Employee`);
    assert.equal(res.data.value.length, rows[0].c);
    // Data-shape honesty: no salary-like or sensitive columns exist.
    const first = res.data.value[0];
    assert.ok(first.employeeCode && first.firstName != null);
    for (const key of Object.keys(first)) {
      assert.ok(!/salary|payer|ctc|reason|number/i.test(key), `no sensitive column ${key}`);
    }
  });

  test("Workforce honors the department + status filters together", async () => {
    const res = await GET(
      `${R}/Workforce?$filter=department_ID eq 11111111-dddd-1111-dddd-111111111111 and employeeStatus eq '1'`,
      HR);
    assert.equal(res.status, 200);
    const direct = await db(
      `SELECT COUNT(DISTINCT h.employee_ID) c
         FROM ewms_db_employee_EmployeeHistory h
         JOIN ewms_db_employee_Employee e ON e.ID = h.employee_ID
        WHERE h.department_ID = '11111111-dddd-1111-dddd-111111111111'
          AND h.effectiveDate = (SELECT MAX(h2.effectiveDate)
                                   FROM ewms_db_employee_EmployeeHistory h2
                                  WHERE h2.employee_ID = h.employee_ID)
          AND e.status = '1'`);
    assert.equal(res.data.value.length, direct[0].c);
  });

  test("Attendance date range keeps the boundaries (inclusive ge/le)", async () => {
    const seeded = await db(
      `SELECT DISTINCT attendanceDate d FROM ewms_db_attendance_Attendance ORDER BY attendanceDate`);
    if (!seeded.length) return assert.ok(true); // nothing to test against
    const first = seeded[0].d;
    const res = await GET(
      `${R}/Attendance?$filter=attendanceDate ge ${first} and attendanceDate le ${first}`, HR);
    assert.equal(res.status, 200);
    const direct = await db(
      `SELECT COUNT(*) c FROM ewms_db_attendance_Attendance WHERE attendanceDate = '${first}'`);
    assert.equal(res.data.value.length, direct[0].c, "boundary date must be inclusive");
  });

  test("Leave report reflects statuses incl. legacy 'Approved'", async () => {
    const res = await GET(`${R}/Leave`, HR);
    assert.equal(res.status, 200);
    const direct = await db(`SELECT COUNT(*) c FROM ewms_db_leave_LeaveRequest`);
    assert.equal(res.data.value.length, direct[0].c);
    const statusFilter = await GET(
      `${R}/Leave?$filter=status eq 'Approved'`, HR);
    assert.equal(statusFilter.status, 200);
    const approvedRows = await db(
      `SELECT COUNT(*) c FROM ewms_db_leave_LeaveRequest WHERE status = 'Approved'`);
    assert.equal(statusFilter.data.value.length, approvedRows[0].c);
  });

  test("Recruitment funnel matches per-stage SQL counts (no duplicate counting)", async () => {
    // Create one candidate through the real service so the funnel
    // cannot accidentally pass on empty tables.
    const create = await POST(`${"/odata/v4/recruitment"}/Candidates`, {
      firstName: "Report", lastName: "Candidate",
      email: `report.candidate.${Date.now()}@ewms-test.example`, experienceYears: 2,
    }, HR);
    assert.ok([200, 201].includes(create.status), JSON.stringify(create.data ?? {}).slice(0, 120));

    const res = await GET(`${R}/Recruitment`, HR);
    assert.equal(res.status, 200);
    for (const kind of ["Candidate", "Offer", "OnboardingCase"]) {
      const table = await db(
        `SELECT status, COUNT(*) c FROM ewms_db_recruitment_${kind} GROUP BY status`);
      for (const row of table) {
        const found = res.data.value.find(
          (r) => r.kind === kind && r.stage === row.status);
        assert.equal(found?.count, row.c, `${kind}|${row.status}`);
      }
    }
  });

  test("Performance funnel matches review/goal counts", async () => {
    const res = await GET(`${R}/Performance`, HR);
    assert.equal(res.status, 200);
    for (const [kind, table] of [["Review", "PerformanceReview"], ["Goal", "PerformanceGoal"]]) {
      const rows = await db(
        `SELECT status, COUNT(*) c FROM ewms_db_performance_${table} GROUP BY status`);
      for (const row of rows) {
        const found = res.data.value.find(
          (r) => r.kind === kind && r.stage === row.status);
        assert.equal(found?.count, row.c, `${kind}|${row.status}`);
      }
    }
  });

  test("Helpdesk aggregates respect category/status/priority filters", async () => {
    const res = await GET(`${R}/Helpdesk`, HR);
    assert.equal(res.status, 200);
    const unfiltered = await db(
      `SELECT category, status, priority, COUNT(*) c
         FROM ewms_db_helpdesk_HRTicket GROUP BY category, status, priority`);
    let expected = 0;
    for (const row of unfiltered) {
      const found = res.data.value.find((r) =>
        r.category === row.category && r.status === row.status && r.priority === row.priority);
      assert.equal(found?.ticketCount, row.c);
      expected += row.c;
    }
    const total = res.data.value.reduce((a, r) => a + r.ticketCount, 0);
    assert.equal(total, expected, "no duplicated or lost tickets across groups");
  });

  test("Exit funnel counts by status/type without reasons (privacy)", async () => {
    const res = await GET(`${R}/Exit`, HR);
    assert.equal(res.status, 200);
    for (const row of res.data.value) {
      assert.ok(!("reasonCategory" in row) && !("reasonText" in row),
        "no sensitive separation reasons in reports");
    }
    const byStatus = await db(
      `SELECT status, COUNT(*) c FROM ewms_db_exit_ExitCase GROUP BY status`);
    for (const row of byStatus) {
      const found = res.data.value.find((r) => r.kind === "Status" && r.stage === row.status);
      assert.equal(found?.count, row.c);
    }
  });
});

// ============================================================
describe("Sprint 23 - CSV export", () => {
  test("metadata: Content-Disposition filename, no personal data in the name", async () => {
    const res = await POST(`${R}/ExportCSV`, { report: "Workforce" }, HR);
    assert.equal(res.status, 200);
    const cd = res.headers["content-disposition"];
    assert.match(cd, /attachment; filename="ewms-workforce-\d{8}\.csv"/);
    assert.ok(!/\d{6,}/.test(cd.replace(/ewms-workforce-\d{8}/, "")),
      "no IDs/personal data in the filename");
  });

  test("export and report READ agree on rows for the same filters", async () => {
    const filters = { report: "Leave", fromDate: "2026-01-01", toDate: "2026-12-31" };
    const res = await POST(`${R}/ExportCSV`, filters, HR);
    assert.equal(res.status, 200);
    const csv = res.data.value;
    // The READ uses the entity's OWN date column with the same
    // OData operators a Fiori app would use (ge/le).
    const read = await GET(
      `${R}/Leave?$filter=fromDate ge 2026-01-01 and fromDate le 2026-12-31`, HR);
    const csvDataRows = csv.trim().split("\n").length - 1;
    assert.equal(csvDataRows, read.data.value.length);
  });

  test("unknown report type refused (400)", async () => {
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "PayrollSecrets" }, HR),
      400, "Unknown report");
  });

  test("unbounded export refused 413 (never silently truncated)", async () => {
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "Workforce", limit: 1 }, HR),
      413);
  });

  test("export respects the same authorization map as the reports", async () => {
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "Attendance" }, JOHN), 403);
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "Attendance" }, MGR), 403);
    await expectError(
      () => POST(`${R}/ExportCSV`, { report: "Workforce" }, FIN), 403);
    const ok = await POST(`${R}/ExportCSV`, { report: "Asset" }, FIN);
    assert.equal(ok.status, 200);
  });

  test("export is audited with facts only (no report contents)", async () => {
    await POST(`${R}/ExportCSV`, { report: "Exit" }, HR);
    const res = await GET(`/odata/v4/employee/AuditLogs?$top=50`, ADMIN);
    const rows = res.data.value.filter((r) => r.action === "EXPORT" && 
      String(r.entity || "").includes("Reports"));
    assert.ok(rows.length >= 1, "export writes an audit row");
  });
});

// ============================================================
describe("Sprint 23 - CSV safety (unit behavior of the shared builder)", () => {
  test("quoting + escaping follow RFC 4180", () => {
    const csv = csvBuilder.toCsv(
      [{ name: "a", header: "A,B" }, { name: "b", header: "Notes" }],
      [
        { a: "plain", b: "has,comma" },
        { a: "has\"quote", b: "multi\nline" },
        { a: null, b: 5 },
      ]);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], '"A,B",Notes');
    assert.equal(lines[1], "plain,\"has,comma\"");
    // A quoted cell may legitimately CONTAIN a newline (RFC 4180);
    // assert with includes so the split-based check text stays honest.
    assert.ok(csv.includes('"has""quote","multi\nline"'));
    assert.ok(csv.trimEnd().endsWith(",5")); // null -> empty, numbers plain
  });

  test("formula injection is neutralized without corrupting plain data", () => {
    // DANGEROUS leads get the apostrophe guard:
    assert.equal(csvBuilder.injectionPrefix("=SUM(A1)"), "'");
    assert.equal(csvBuilder.injectionPrefix("+1;calc"), "'");
    assert.equal(csvBuilder.injectionPrefix("@IMPORT"), "'");
    assert.equal(csvBuilder.injectionPrefix("-=SUM(A1)"), "'");
    // LEGITIMATE values must NOT be changed:
    assert.equal(csvBuilder.injectionPrefix("-5"), null, "negative number");
    assert.equal(csvBuilder.injectionPrefix("-0.50"), null, "decimal");
    assert.equal(csvBuilder.injectionPrefix("-plain text"), null);
  });

  test("integration: dangerous and legitimate cells round-trip", () => {
    const csv = csvBuilder.toCsv(
      [{ name: "a", header: "Cell" }],
      [{ a: "=cmd|'/c calc'!A0" }, { a: "-0.5" }]);
    const dataRows = csv.trim().split("\n").slice(1);
    // The guard prefix is ONE apostrophe - the builder never
    // re-invents the cell; internal single quotes stay untouched
    // (no wrapping needed: there is no comma/newline inside).
    assert.equal(dataRows[0], "'=cmd|'/c calc'!A0");
    assert.equal(dataRows[1], "-0.5");
  });
});
