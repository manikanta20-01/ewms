const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const A = require("../../common/utils/analytics-queries");

// ============================================================
// SPRINT 23 - REPORT ROW BUILDERS
// ------------------------------------------------------------
// THE single implementation of each report's rows. The interactive
// READ handlers and the ExportCSV action both call these, so a
// report and its export can never disagree (filter parity is
// structural, not a promise).
//
// Metric logic is NOT re-invented: builders pull the shared
// Sprint 22 analytics helpers / primitives (`A.*`) wherever they
// overlap (funnels, expiry rule, day/inRange/countBy utilities).
//
// Every builder receives already-VALIDATED filters and returns
// plain row objects whose keys mirror the service entities (the
// exporter maps them through the stable CSV column definitions
// below).
// ============================================================

/** "John Doe" from master names (never a phenically padded row). */
function fullName(e) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || null;
}

// ------------------------------------------------------------
// CSV column definitions - STABLE machine-readable names +
// human-readable headers (Fiori/download metadata).
// ------------------------------------------------------------
const COLUMNS = {
  Workforce: [
    { name: "employeeCode", header: "EmployeeCode" },
    { name: "firstName", header: "FirstName" },
    { name: "lastName", header: "LastName" },
    { name: "employeeStatus", header: "Status" },
    { name: "employmentType", header: "EmploymentType" },
    { name: "joiningDate", header: "JoiningDate" },
    { name: "departmentName", header: "Department" },
  ],
  Attendance: [
    { name: "employeeCode", header: "EmployeeCode" },
    { name: "employeeName", header: "EmployeeName" },
    { name: "attendanceDate", header: "Date" },
    { name: "attendanceStatus", header: "AttendanceStatus" },
    { name: "workLocation", header: "WorkLocation" },
    { name: "workedHours", header: "WorkedHours" },
    { name: "lateMinutes", header: "LateMinutes" },
  ],
  Leave: [
    { name: "leaveNumber", header: "LeaveNumber" },
    { name: "employeeCode", header: "EmployeeCode" },
    { name: "employeeName", header: "EmployeeName" },
    { name: "leaveTypeCode", header: "LeaveType" },
    { name: "status", header: "Status" },
    { name: "fromDate", header: "FromDate" },
    { name: "toDate", header: "ToDate" },
    { name: "totalDays", header: "TotalDays" },
  ],
  Recruitment: [
    { name: "kind", header: "Kind" },
    { name: "stage", header: "Stage" },
    { name: "count", header: "Count" },
  ],
  Performance: [
    { name: "kind", header: "Kind" },
    { name: "stage", header: "Stage" },
    { name: "count", header: "Count" },
  ],
  Asset: [
    { name: "assetTag", header: "AssetTag" },
    { name: "assetName", header: "AssetName" },
    { name: "assetStatus", header: "Status" },
    { name: "categoryName", header: "Category" },
    { name: "holderEmployeeCode", header: "CurrentHolderCode" },
    { name: "holderName", header: "CurrentHolder" },
    { name: "assignedOn", header: "AssignedOn" },
    { name: "condition", header: "Condition" },
  ],
  DocumentExpiry: [
    { name: "employeeCode", header: "EmployeeCode" },
    { name: "employeeName", header: "EmployeeName" },
    { name: "documentType", header: "DocumentType" },
    { name: "documentNumber", header: "DocumentNumber" },
    { name: "documentStatus", header: "DocumentStatus" },
    { name: "expiryDate", header: "ExpiryDate" },
    { name: "daysUntilExpiry", header: "DaysUntilExpiry" },
  ],
  Helpdesk: [
    { name: "category", header: "Category" },
    { name: "status", header: "Status" },
    { name: "priority", header: "Priority" },
    { name: "ticketCount", header: "TicketCount" },
  ],
  Exit: [
    { name: "kind", header: "Kind" },
    { name: "stage", header: "Stage" },
    { name: "count", header: "Count" },
  ],
};

// ------------------------------------------------------------
// WORKFORCE
// ------------------------------------------------------------
async function workforce(tx, f = {}) {
  const emps = await tx.run(SELECT.from(A.T.employee)
    .columns("ID", "employeeCode", "firstName", "lastName",
      "employmentType", "joiningDate", "status"));
  // Latest EmployeeHistory per employee = the department rule.
  const hist = await tx.run(SELECT.from(A.T.employeeHistory)
    .columns("employee_ID", "department_ID", "effectiveDate")
    .orderBy("effectiveDate"));
  const latest = new Map();
  for (const h of hist || []) {
    if (h.department_ID) latest.set(h.employee_ID, h.department_ID);
  }
  const depts = await tx.run(SELECT.from(A.T.department)
    .columns("ID", "departmentName"));
  const deptName = new Map((depts || []).map((d) => [d.ID, d.departmentName]));

  let rows = (emps || []).map((e) => ({
    employee_ID: e.ID,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    employeeStatus: e.status,
    employmentType: e.employmentType,
    joiningDate: e.joiningDate ?? null,
    department_ID: latest.get(e.ID) ?? null,
    departmentName: latest.has(e.ID)
      ? deptName.get(latest.get(e.ID)) ?? null : null,
  }));
  if (f.department_ID) {
    rows = rows.filter((r) => String(r.department_ID) === String(f.department_ID));
  }
  if (f.status) rows = rows.filter((r) => r.employeeStatus === f.status);
  if (f.fromDate || f.toDate) {
    rows = rows.filter((r) => A.inRange(A.day(r.joiningDate), f.fromDate, f.toDate));
  }
  return rows.sort((a, b) => (a.employeeCode || "").localeCompare(b.employeeCode || ""));
}

// ------------------------------------------------------------
// ATTENDANCE
// ------------------------------------------------------------
async function attendance(tx, f = {}) {
  let rows = await tx.run(SELECT.from(A.T.attendance)
    .columns("ID", "employee_ID", "attendanceDate", "attendanceStatus",
      "workLocation", "workedHours", "lateMinutes"));
  if (f.employee_ID) {
    rows = (rows || []).filter((r) => String(r.employee_ID) === String(f.employee_ID));
  }
  const empIds = [...new Set(rows.map((r) => r.employee_ID))];
  const emps = empIds.length ? await tx.run(SELECT.from(A.T.employee)
    .columns("ID", "employeeCode", "firstName", "lastName")) : [];
  const empById = new Map((emps || []).map((e) => [e.ID, e]));

  const out = (rows || [])
    .filter((r) => A.inRange(A.day(r.attendanceDate), f.fromDate, f.toDate))
    .filter((r) => !f.attendanceStatus || r.attendanceStatus === f.attendanceStatus)
    .map((r) => {
      const e = empById.get(r.employee_ID);
      return {
        ID: r.ID,
        employee_ID: r.employee_ID,
        employeeCode: e?.employeeCode ?? null,
        employeeName: e ? fullName(e) : null,
        attendanceDate: r.attendanceDate,
        attendanceStatus: r.attendanceStatus,
        workLocation: r.workLocation,
        workedHours: r.workedHours,
        lateMinutes: r.lateMinutes,
      };
    })
    .sort((a, b) => String(b.attendanceDate).localeCompare(String(a.attendanceDate)) ||
      String(a.employeeCode || "").localeCompare(String(b.employeeCode || "")));
  return out;
}

// ------------------------------------------------------------
// LEAVE
// ------------------------------------------------------------
async function leave(tx, f = {}) {
  const types = await tx.run(SELECT.from(A.T.leaveType)
    .columns("ID", "leaveCode"));
  const typeCode = new Map((types || []).map((t) => [t.ID, t.leaveCode]));
  let rows = await tx.run(SELECT.from(A.T.leaveRequest)
    .columns("ID", "leaveNumber", "leaveType_ID", "employee_ID",
      "fromDate", "toDate", "totalDays", "status"));
  const emps = await tx.run(SELECT.from(A.T.employee)
    .columns("ID", "employeeCode", "firstName", "lastName"));
  const empById = new Map((emps || []).map((e) => [e.ID, e]));

  return (rows || [])
    .filter((r) => A.inRange(A.day(r.fromDate), f.fromDate, f.toDate))
    .filter((r) => !f.status || r.status === f.status)
    .filter((r) => !f.employee_ID || String(r.employee_ID) === String(f.employee_ID))
    .filter((r) => !f.leaveType_ID || String(r.leaveType_ID) === String(f.leaveType_ID))
    .map((r) => {
      const e = empById.get(r.employee_ID);
      return {
        ID: r.ID,
        leaveNumber: r.leaveNumber,
        employee_ID: r.employee_ID,
        employeeCode: e?.employeeCode ?? null,
        employeeName: e ? fullName(e) : null,
        leaveType_ID: r.leaveType_ID,
        leaveTypeCode: typeCode.get(r.leaveType_ID) ?? null,
        status: r.status,
        fromDate: r.fromDate,
        toDate: r.toDate,
        totalDays: r.totalDays,
      };
    })
    .sort((a, b) => String(b.fromDate).localeCompare(String(a.fromDate)) ||
      String(a.leaveNumber || "").localeCompare(String(b.leaveNumber || "")));
}

// ------------------------------------------------------------
// RECRUITMENT / PERFORMANCE / EXIT (aggregated funnels)
// ------------------------------------------------------------
async function recruitment(tx, f = {}) {
  let rows = (await A.recruitmentFunnel(tx)).map((r) => ({
    kind: r.source, stage: r.stage, count: r.count,
  }));
  if (f.kind) rows = rows.filter((r) => r.kind === f.kind);
  if (f.stage) rows = rows.filter((r) => r.stage === f.stage);
  return rows;
}

async function performance(tx, f = {}) {
  let rows = (await A.performanceStatusCounts(tx)).map((r) => ({
    kind: r.source, stage: r.stage, count: r.count,
  }));
  if (f.kind) rows = rows.filter((r) => r.kind === f.kind);
  if (f.stage) rows = rows.filter((r) => r.stage === f.stage);
  return rows;
}

async function exit(tx, f = {}) {
  let rows = (await A.exitStatusCounts(tx)).map((r) => ({
    kind: r.source, stage: r.stage, count: r.count,
  }));
  // Export may target one exit type explicitly.
  if (f.exitType) rows = rows.filter((r) => r.kind === "Type" && r.stage === f.exitType);
  if (f.kind) rows = rows.filter((r) => r.kind === f.kind);
  if (f.stage) rows = rows.filter((r) => r.stage === f.stage);
  return rows;
}

// ------------------------------------------------------------
// ASSETS
// ------------------------------------------------------------
async function asset(tx, f = {}) {
  const assets = await tx.run(SELECT.from(A.T.asset)
    .columns("ID", "assetTag", "name", "status", "category_ID", "condition"));
  const cats = await tx.run(SELECT.from(A.T.assetCategory)
    .columns("ID", "name"));
  const catName = new Map((cats || []).map((c) => [c.ID, c.name]));
  const actives = await tx.run(SELECT.from(A.T.assetAssignment)
    .columns("asset_ID", "employee_ID", "assignmentDate")
    .where({ status: "Active" }));
  // One ACTIVE assignment per asset by design - but guard AGAINST
  // duplicate counting anyway by keeping the last row only.
  const holder = new Map(); // asset_ID -> { employee_ID, assignedOn }
  for (const a of actives || []) {
    holder.set(a.asset_ID, { employee_ID: a.employee_ID, assignedOn: a.assignmentDate });
  }

  const emps = await tx.run(SELECT.from(A.T.employee)
    .columns("ID", "employeeCode", "firstName", "lastName"));
  const empById = new Map((emps || []).map((e) => [e.ID, e]));

  let rows = (assets || []).map((s) => {
    const h = holder.get(s.ID);
    const he = h ? empById.get(h.employee_ID) : null;
    return {
      ID: s.ID,
      assetTag: s.assetTag,
      assetName: s.name,
      assetStatus: s.status,
      categoryName: catName.get(s.category_ID) ?? null,
      holderEmployeeCode: he?.employeeCode ?? null,
      holderName: he ? fullName(he) : null,
      assignedOn: h?.assignedOn ?? null,
      condition: s.condition ?? null,
    };
  });
  if (f.assetStatus || f.status) {
    const want = f.assetStatus || f.status;
    rows = rows.filter((r) => r.assetStatus === want);
  }
  if (f.employee_ID) {
    // Custody filter: only assets CURRENTLY held by this employee
    // (via the ACTIVE assignment - the ledger is the authority).
    rows = rows.filter((r) => {
      const h = holder.get(r.ID);
      return h && String(h.employee_ID) === String(f.employee_ID);
    });
  }
  return rows.sort((a, b) =>
    (a.assetTag || "").localeCompare(b.assetTag || ""));
}

// ------------------------------------------------------------
// DOCUMENT EXPIRY (Sprint 17 rule, reused)
// ------------------------------------------------------------
async function documentExpiry(tx, f = {}) {
  const alerts = await A.expiringWindowByType(tx);
  const docs = await tx.run(SELECT.from(A.T.document)
    .columns("ID", "employee_ID", "documentType", "documentNumber",
      "expiryDate", "verified")
    .where({ status: "Active" }));
  const emps = await tx.run(SELECT.from(A.T.employee)
    .columns("ID", "employeeCode", "firstName", "lastName"));
  const empById = new Map((emps || []).map((e) => [e.ID, e]));
  const d = A.today();

  let rows = (docs || [])
    .filter((r) => r.expiryDate != null)
    .map((r) => {
      const e = empById.get(r.employee_ID);
      const window = alerts.get(r.documentType) || 0;
      const daysLeft = Math.round(
        (Date.parse(`${r.expiryDate}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000));
      // Same language as the compliance module: only VERIFIED
      // documents can be Valid/Expiring/Expired; an unverified doc
      // is PendingVerification no matter what its dates say.
      let documentStatus = "PendingVerification";
      if (r.verified) {
        documentStatus = r.expiryDate < d ? "Expired"
          : (window > 0 && r.expiryDate <= A.addDays(d, window) ? "Expiring" : "Valid");
      }
      return {
        ID: r.ID,
        employee_ID: r.employee_ID,
        employeeCode: e?.employeeCode ?? null,
        employeeName: e ? fullName(e) : null,
        documentType: r.documentType,
        documentNumber: r.documentNumber ?? null,
        expiryDate: r.expiryDate,
        documentStatus,
        daysUntilExpiry: daysLeft,
      };
    })
    .filter((r) => A.inRange(A.day(r.expiryDate), f.fromDate, f.toDate))
    .filter((r) => !f.documentType || r.documentType === f.documentType)
    .filter((r) => !f.documentStatus || r.documentStatus === f.documentStatus);
  return rows.sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)) ||
    String(a.employeeCode || "").localeCompare(String(b.employeeCode || "")));
}

// ------------------------------------------------------------
// HELPDESK (aggregated by category + status + priority)
// ------------------------------------------------------------
async function helpdesk(tx, f = {}) {
  const tickets = await tx.run(SELECT.from(A.T.ticket)
    .columns("category", "status", "priority", "createdAt"));
  const counts = new Map();
  for (const t of tickets || []) {
    if (!A.inRange(A.day(t.createdAt), f.fromDate, f.toDate)) continue;
    if (f.category && t.category !== f.category) continue;
    if (f.status && t.status !== f.status) continue;
    if (f.priority && t.priority !== f.priority) continue;
    const key = `${t.category}|${t.status}|${t.priority}`;
    const prev = counts.get(key) || { category: t.category, status: t.status, priority: t.priority, ticketCount: 0 };
    prev.ticketCount += 1;
    counts.set(key, prev);
  }
  return [...counts.values()];
}

module.exports = { COLUMNS, fullName, builders: {
  Workforce: workforce,
  Attendance: attendance,
  Leave: leave,
  Recruitment: recruitment,
  Performance: performance,
  Asset: asset,
  DocumentExpiry: documentExpiry,
  Helpdesk: helpdesk,
  Exit: exit,
} };
