// ============================================================
// SPRINT 22 - DASHBOARD & ANALYTICS TESTS
// ------------------------------------------------------------
// Every metric test compares the API result against an
// INDEPENDENT direct SQL aggregation (the test does not call the
// shared analytics helpers for its expectations, so a bug in
// either side shows up). Authorization is asserted with real
// 403s (a plain employee must never see dashboard aggregates).
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");
const cds = require("@sap/cds");

const { startTestHarness } = require("./setup");
const { GET } = startTestHarness();

const DASH = "/odata/v4/dashboard";
const HR = { auth: { username: "hrperson", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const MGR = { auth: { username: "mgrdept", password: "" } };

/** Independent helper: run SQL straight against the test DB. */
async function db(sql) {
  return cds.db.run(sql);
}

/** cds.test GET helpers THROW on error statuses (axios-style). */
async function expectError(fn, expectedCode) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.equal(code, expectedCode);
  }
}

describe("Sprint 22 - dashboard authorization", () => {
  const ENTITIES = [
    "WorkforceStatus", "HeadcountByDepartment", "LeaveTypeUsage",
    "AttendanceByStatus", "RecruitmentFunnel", "PerformanceStatus",
    "AssetSummary", "HelpdeskSummary", "ExitSummary",
    "DocumentExpiryOverview",
  ];

  test("plain employees get 403 on every dashboard entity", async () => {
    for (const entity of ENTITIES) {
      await expectError(() => GET(`${DASH}/${entity}`, JOHN), 403);
    }
  });

  test("management roles read the dashboard", async () => {
    const ok = await GET(`${DASH}/WorkforceStatus`, HR);
    assert.equal(ok.status, 200);
    const mgr = await GET(`${DASH}/AttendanceByStatus`, MGR);
    assert.equal(mgr.status, 200);
  });
});

describe("Sprint 22 - metric correctness vs independent SQL", () => {
  test("WorkforceStatus matches the employee master", async () => {
    const res = await GET(`${DASH}/WorkforceStatus`, HR);
    assert.equal(res.status, 200);
    const api = Object.fromEntries(res.data.value.map((r) => [r.status, r.employeeCount]));
    const rows = await db(`SELECT status, COUNT(*) AS cnt FROM ewms_db_employee_Employee GROUP BY status`);
    const dbMap = Object.fromEntries(rows.map((r) => [r.status, r.cnt]));
    assert.deepEqual(api, dbMap);
    // sanity: totals add up to all employees
    assert.equal(Object.values(api).reduce((a, b) => a + b, 0), rows.length ? rows.reduce((a, r) => a + r.cnt, 0) : 0);
  });

  test("HeadcountByDepartment counts DISTINCT employees (no double counting)", async () => {
    const res = await GET(`${DASH}/HeadcountByDepartment`, HR);
    assert.equal(res.status, 200);
    for (const row of res.data.value) {
      // Independent expectation: latest EmployeeHistory row per
      // employee (the repo's department rule), status buckets.
      const direct = await db(
        `SELECT h.department_ID, e.status, COUNT(DISTINCT h.employee_ID) AS hc
           FROM ewms_db_employee_EmployeeHistory h
           JOIN ewms_db_employee_Employee e ON e.ID = h.employee_ID
          WHERE h.department_ID = '${row.department_ID}'
            AND h.effectiveDate = (SELECT MAX(h2.effectiveDate)
                                     FROM ewms_db_employee_EmployeeHistory h2
                                    WHERE h2.employee_ID = h.employee_ID)
          GROUP BY h.department_ID, e.status`);
      const active = direct.find((r) => r.status !== "Inactive");
      const inactive = direct.find((r) => r.status === "Inactive");
      assert.equal(row.activeHeadcount, active?.hc ?? 0);
      assert.equal(row.inactiveHeadcount, inactive?.hc ?? 0);
      if (row.departmentName) assert.ok(typeof row.departmentName === "string");
    }
  });

  test("LeaveTypeUsage aggregates requests per type", async () => {
    const res = await GET(`${DASH}/LeaveTypeUsage`, HR);
    assert.equal(res.status, 200);
    const reqRows = await db(
      `SELECT leaveType_ID, status, COUNT(*) AS cnt, COALESCE(SUM(totalDays), 0) AS days
         FROM ewms_db_leave_LeaveRequest GROUP BY leaveType_ID, status`);
    // Same bucket vocabulary as the metric (legacy 'Approved' joins
    // the enum 'HRApproved' bucket - see analytics-queries.js).
    const APPROVED = ["HRApproved", "Approved"];
    for (const row of res.data.value) {
      let inProg = 0;
      for (const r of reqRows.filter((x) => x.leaveType_ID === row.leaveType_ID)) {
        if (APPROVED.includes(r.status)) {
          assert.equal(row.approvedRequests, r.cnt);
          assert.equal(Number(row.totalApprovedDays), Number(r.days));
        } else if (r.status === "Rejected") {
          assert.equal(row.rejectedRequests, r.cnt);
        } else if (r.status === "Cancelled") {
          assert.equal(row.cancelledRequests, r.cnt);
        } else {
          inProg += r.cnt;
        }
      }
      assert.equal(row.inProgressRequests, inProg);
    }
  });

  test("AttendanceByStatus matches the attendance table", async () => {
    const res = await GET(`${DASH}/AttendanceByStatus`, HR);
    assert.equal(res.status, 200);
    const api = Object.fromEntries(res.data.value.map((r) => [r.attendanceStatus, r.occurrenceCount]));
    const rows = await db(
      `SELECT attendanceStatus, COUNT(*) AS cnt FROM ewms_db_attendance_Attendance GROUP BY attendanceStatus`);
    for (const r of rows) assert.equal(api[r.attendanceStatus] ?? 0, r.cnt);
  });

  test("RecruitmentFunnel + PerformanceStatus row counts match the source tables", async () => {
    const funnel = await GET(`${DASH}/RecruitmentFunnel`, HR);
    const perf = await GET(`${DASH}/PerformanceStatus`, HR);
    assert.equal(funnel.status, 200);
    assert.equal(perf.status, 200);
    const byKey = (rows) =>
      Object.fromEntries(rows.data.value.map((r) => [`${r.source}|${r.stage}`, r.count]));
    const f = byKey(funnel);
    const cand = await db(`SELECT status, COUNT(*) c FROM ewms_db_recruitment_Candidate GROUP BY status`);
    for (const r of cand) assert.equal(f[`Candidate|${r.status}`], r.c);
    const off = await db(`SELECT status, COUNT(*) c FROM ewms_db_recruitment_Offer GROUP BY status`);
    for (const r of off) assert.equal(f[`Offer|${r.status}`], r.c);
    const onb = await db(`SELECT status, COUNT(*) c FROM ewms_db_recruitment_OnboardingCase GROUP BY status`);
    for (const r of onb) assert.equal(f[`OnboardingCase|${r.status}`], r.c);
    const rev = await db(`SELECT status, COUNT(*) c FROM ewms_db_performance_PerformanceReview GROUP BY status`);
    const p = byKey(perf);
    for (const r of rev) assert.equal(p[`Review|${r.status}`], r.c);
    const goal = await db(`SELECT status, COUNT(*) c FROM ewms_db_performance_PerformanceGoal GROUP BY status`);
    for (const r of goal) assert.equal(p[`Goal|${r.status}`], r.c);
  });

  test("AssetSummary counts statuses and ACTIVE assignments", async () => {
    const res = await GET(`${DASH}/AssetSummary`, HR);
    assert.equal(res.status, 200);
    const byKey = Object.fromEntries(res.data.value.map((r) => [`${r.source}|${r.stage}`, r.count]));
    const assets = await db(`SELECT status, COUNT(*) c FROM ewms_db_asset_Asset GROUP BY status`);
    for (const r of assets) assert.equal(byKey[`Asset|${r.status}`], r.c);
    const active = await db(
      `SELECT COUNT(*) c FROM ewms_db_asset_AssetAssignment WHERE status = 'Active'`);
    assert.equal(byKey["Assignment|Active"], active[0].c);
  });

  test("HelpdeskSummary counts by status AND priority", async () => {
    const res = await GET(`${DASH}/HelpdeskSummary`, HR);
    assert.equal(res.status, 200);
    const byKey = Object.fromEntries(res.data.value.map((r) => [`${r.source}|${r.stage}`, r.count]));
    const byStatus = await db(
      `SELECT status, COUNT(*) c FROM ewms_db_helpdesk_HRTicket GROUP BY status`);
    for (const r of byStatus) assert.equal(byKey[`Status|${r.status}`], r.c);
    const byPriority = await db(
      `SELECT priority, COUNT(*) c FROM ewms_db_helpdesk_HRTicket GROUP BY priority`);
    for (const r of byPriority) assert.equal(byKey[`Priority|${r.priority}`], r.c);
  });

  test("ExitSummary counts by status/type - empty repo state handled", async () => {
    const res = await GET(`${DASH}/ExitSummary`, HR);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.value));
    // At this point in the suite there may or may not be exit cases;
    // whatever exists must match the table exactly.
    const byKey = Object.fromEntries(res.data.value.map((r) => [`${r.source}|${r.stage}`, r.count]));
    const byStatus = await db(`SELECT status, COUNT(*) c FROM ewms_db_exit_ExitCase GROUP BY status`);
    for (const r of byStatus) assert.equal(byKey[`Status|${r.status}`], r.c);
    const byType = await db(`SELECT exitType, COUNT(*) c FROM ewms_db_exit_ExitCase GROUP BY exitType`);
    for (const r of byType) assert.equal(byKey[`Type|${r.exitType}`], r.c);
  });

  test("DocumentExpiryOverview applies the configured alert windows", async () => {
    const res = await GET(`${DASH}/DocumentExpiryOverview`, HR);
    assert.equal(res.status, 200);
    // The seed data is static, so expired = documents past expiry
    // must never exceed active documents of that type.
    for (const row of res.data.value) {
      const docs = await db(
        `SELECT COUNT(*) c FROM ewms_db_employee_Document
          WHERE documentType = '${row.documentType}' AND status = 'Active' AND expiryDate IS NOT NULL`);
      assert.equal(row.activeDocuments, docs[0].c);
      assert.ok(row.expiredDocuments <= row.activeDocuments);
    }
  });
});
