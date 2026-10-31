// ============================================================
// SHARED ANALYTICS QUERIES (Sprint 22 Dashboard / Sprint 23 Reports)
// ------------------------------------------------------------
// ONE place computes every metric used by the Sprint 22 Dashboard
// Service and the Sprint 23 Reports + Export service.
//
//   * Dashboard  = coarse, site-wide counts (no row data).
//   * Reports    = same domains + filters + richer columns;
//                  metric LOGIC is never duplicated here vs there.
//
// Beginner notes:
//   * Every query runs INSIDE the caller's transaction (tx) so
//     a report never reads a half-applied write.
//   * Helpers fetch ONLY the columns needed for the metric and
//     aggregate in JS - the same lightweight pattern the helpdesk
//     OverdueTickets handler uses. We never pull full row payloads
//     (addresses, compensation, document bytes) for a metric.
//   * Filters are always plain AND combinations, applied
//     server-side before anything is returned.
//   * Dates are plain ISO 'YYYY-MM-DD' strings in the database.
//     "Today" always means the UTC date - SQLite stores no
//     timezone, so the sprint standardizes on UTC (decision
//     documented in SPRINT-23.md).
// ============================================================

const cds = require("@sap/cds");
const { SELECT } = cds.ql;

// Table references (full qualified names, same strings the other
// modules use) - kept here so both services point at ONE place.
const T = {
  employee: "ewms.db.employee.Employee",
  assignment: "ewms.db.employee.EmployeeAssignment",
  employeeHistory: "ewms.db.employee.EmployeeHistory",
  document: "ewms.db.employee.Document",
  leaveRequest: "ewms.db.leave.LeaveRequest",
  leaveType: "ewms.db.leave.LeaveType",
  attendance: "ewms.db.attendance.Attendance",
  candidate: "ewms.db.recruitment.Candidate",
  offer: "ewms.db.recruitment.Offer",
  onboarding: "ewms.db.recruitment.OnboardingCase",
  review: "ewms.db.performance.PerformanceReview",
  goal: "ewms.db.performance.PerformanceGoal",
  asset: "ewms.db.asset.Asset",
  assetCategory: "ewms.db.asset.AssetCategory",
  assetAssignment: "ewms.db.asset.AssetAssignment",
  ticket: "ewms.db.helpdesk.HRTicket",
  exitCase: "ewms.db.exit.ExitCase",
  department: "ewms.db.organization.Department",
  requirement: "ewms.db.compliance.DocumentRequirement",
};

/** Today as a plain ISO date string (the UTC "business day"). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** yyyy-mm-dd + N days (used for the configurable expiry window). */
function addDays(dateStr, days) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Plain-ISO date of any stored date/timestamp value (string safe). */
function day(value) {
  return value == null ? null : String(value).slice(0, 10);
}

function inRange(value, fromDate, toDate) {
  if (value == null) return false;
  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;
  return true;
}

/** Group JS rows by one field: Map(fieldValue -> count). */
function countBy(rows, field) {
  const out = new Map();
  for (const r of rows || []) {
    const key = r[field] ?? "Unknown";
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

// ------------------------------------------------------------
// WORKFORCE
// ------------------------------------------------------------

/** Employees by master status (Active / Inactive / ...). */
async function workforceStatusCounts(tx) {
  const emps = await tx.run(SELECT.from(T.employee).columns("status"));
  const counts = countBy(emps, "status");
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

/**
 * HEADCOUNT PER DEPARTMENT.
 * Department of an employee = the LATEST EmployeeHistory row
 * (the established rule in this repo - the helpdesk and policy
 * modules resolve departments the same way; the assignment
 * table carries project data, not the department).
 * Distinct SETS of employee IDs prevent double counting when
 * an employee has several history rows or assignments.
 */
async function headcountByDepartment(tx) {
  const emps = await tx.run(SELECT.from(T.employee).columns("ID", "status"));
  const statusById = new Map((emps || []).map((e) => [e.ID, e.status]));

  // Latest history row per employee (rows come ordered by date).
  const hist = await tx.run(SELECT.from(T.employeeHistory)
    .columns("employee_ID", "department_ID", "effectiveDate")
    .orderBy("effectiveDate"));
  const latest = new Map(); // employee_ID -> department_ID
  for (const h of hist || []) {
    if (h.department_ID) latest.set(h.employee_ID, h.department_ID);
  }

  const stats = new Map(); // department_ID -> { active:Set, inactive:Set }
  for (const [empId, deptId] of latest) {
    if (!stats.has(deptId)) {
      stats.set(deptId, { active: new Set(), inactive: new Set() });
    }
    const st = stats.get(deptId);
    (statusById.get(empId) === "Inactive" ? st.inactive : st.active)
      .add(empId);
  }

  const depts = await tx.run(SELECT.from(T.department)
    .columns("ID", "departmentName"));
  const nameById = new Map((depts || []).map((d) => [d.ID, d.departmentName]));

  return [...stats.entries()].map(([deptId, st]) => ({
    department_ID: deptId,
    departmentName: nameById.get(deptId) ?? null,
    activeHeadcount: st.active.size,
    inactiveHeadcount: st.inactive.size,
  }));
}

// ------------------------------------------------------------
// LEAVE
// ------------------------------------------------------------

/**
 * Leave usage per TYPE for an optional date range (a request
 * belongs to the report when its fromDate falls inside it).
 *
 * Bucket note (beginner-friendly): the CURRENT leave workflow
 * writes the enum vocabulary (HRApproved = final approval,
 * Team/ProjectApproved = intermediate). Older seed data still
 * carries the legacy word "Approved" - both are counted in the
 * SAME approved bucket so the system never hides an approval.
 * Rejected / Cancelled keep their own columns; everything else
 * (Draft / Pending / any intermediate approval) is inProgress.
 */
const APPROVED_STATUSES = ["HRApproved", "Approved"];
const REJECTED_STATUSES = ["Rejected"];
const CANCELLED_STATUSES = ["Cancelled"];

async function leaveUsageByType(tx, { fromDate, toDate } = {}) {
  const types = await tx.run(SELECT.from(T.leaveType)
    .columns("ID", "leaveCode", "name"));
  const reqs = await tx.run(SELECT.from(T.leaveRequest)
    .columns("leaveType_ID", "status", "totalDays", "fromDate"));

  const usage = new Map();
  for (const t of types || []) {
    usage.set(t.ID, {
      leaveType_ID: t.ID,
      leaveTypeCode: t.leaveCode,
      leaveTypeName: t.name,
      totalRequests: 0, inProgressRequests: 0,
      approvedRequests: 0, rejectedRequests: 0, cancelledRequests: 0,
      totalApprovedDays: 0,
    });
  }
  for (const r of reqs || []) {
    const row = usage.get(r.leaveType_ID);
    if (!row) continue; // request for an unknown/inactive type
    if (!inRange(day(r.fromDate), fromDate, toDate)) continue;
    row.totalRequests += 1;
    const days = Number(r.totalDays || 0);
    if (APPROVED_STATUSES.includes(r.status)) {
      row.approvedRequests += 1;
      row.totalApprovedDays += days;
    } else if (REJECTED_STATUSES.includes(r.status)) row.rejectedRequests += 1;
    else if (CANCELLED_STATUSES.includes(r.status)) row.cancelledRequests += 1;
    else row.inProgressRequests += 1; // Draft/Pending/intermediate approvals
  }
  for (const row of usage.values()) {
    row.totalApprovedDays = Math.round(row.totalApprovedDays * 100) / 100;
  }
  return [...usage.values()].sort((a, b) =>
    (a.leaveTypeCode || "").localeCompare(b.leaveTypeCode || ""));
}

// ------------------------------------------------------------
// ATTENDANCE
// ------------------------------------------------------------

/** Attendance rows per status for optional range + employee filter. */
async function attendanceStatusCounts(tx, { fromDate, toDate, employee_ID } = {}) {
  const rows = await tx.run(SELECT.from(T.attendance)
    .columns("attendanceStatus", "attendanceDate", "employee_ID"));
  const filtered = (rows || []).filter((r) => {
    if (!inRange(day(r.attendanceDate), fromDate, toDate)) return false;
    if (employee_ID && String(r.employee_ID) !== String(employee_ID)) return false;
    return true;
  });
  const counts = countBy(filtered, "attendanceStatus");
  return [...counts.entries()].map(([attendanceStatus, count]) =>
    ({ attendanceStatus, count }));
}

// ------------------------------------------------------------
// RECRUITMENT (funnel rows: source + stage + count)
// ------------------------------------------------------------

async function recruitmentFunnel(tx) {
  const [cand, off, onb] = await Promise.all([
    tx.run(SELECT.from(T.candidate).columns("status")),
    tx.run(SELECT.from(T.offer).columns("status")),
    tx.run(SELECT.from(T.onboarding).columns("status")),
  ]);
  const rows = []
    .concat([...countBy(cand, "status")].map(([s, c]) => ({ source: "Candidate", stage: s, count: c })))
    .concat([...countBy(off, "status")].map(([s, c]) => ({ source: "Offer", stage: s, count: c })))
    .concat([...countBy(onb, "status")].map(([s, c]) => ({ source: "OnboardingCase", stage: s, count: c })));
  return rows;
}

// ------------------------------------------------------------
// PERFORMANCE (rows: source + stage + count)
// ------------------------------------------------------------

async function performanceStatusCounts(tx) {
  const [rev, go] = await Promise.all([
    tx.run(SELECT.from(T.review).columns("status")),
    tx.run(SELECT.from(T.goal).columns("status")),
  ]);
  return []
    .concat([...countBy(rev, "status")].map(([s, c]) => ({ source: "Review", stage: s, count: c })))
    .concat([...countBy(go, "status")].map(([s, c]) => ({ source: "Goal", stage: s, count: c })));
}

// ------------------------------------------------------------
// ASSETS
// ------------------------------------------------------------

/** Assets per lifecycle status + ACTIVE assignment count. */
async function assetStatusCounts(tx) {
  const assets = await tx.run(SELECT.from(T.asset).columns("status"));
  const rows = [...countBy(assets, "status")]
    .map(([stage, count]) => ({ source: "Asset", stage, count }));
  const active = await tx.run(SELECT.from(T.assetAssignment)
    .columns("status").where({ status: "Active" }));
  rows.push({ source: "Assignment", stage: "Active", count: (active || []).length });
  return rows;
}

// ------------------------------------------------------------
// HELPDESK
// ------------------------------------------------------------

async function helpdeskStatusCounts(tx, { fromDate, toDate } = {}) {
  const tickets = await tx.run(SELECT.from(T.ticket)
    .columns("status", "priority", "createdAt"));
  const rows = new Map();
  for (const t of tickets || []) {
    if (!inRange(day(t.createdAt), fromDate, toDate)) continue;
    for (const [source, stage] of [["Status", t.status], ["Priority", t.priority]]) {
      if (stage == null) continue;
      const key = `${source}|${stage}`;
      rows.set(key, { source, stage, count: (rows.get(key)?.count || 0) + 1 });
    }
  }
  return [...rows.values()];
}

// ------------------------------------------------------------
// EXITS
// ------------------------------------------------------------

async function exitStatusCounts(tx) {
  const cases = await tx.run(SELECT.from(T.exitCase)
    .columns("status", "exitType"));
  const byStatus = countBy(cases, "status");
  const byType = countBy(cases, "exitType");
  const rows = [
    ...[...byStatus].map(([s, c]) => ({ source: "Status", stage: s, count: c })),
    ...[...byType].map(([s, c]) => ({ source: "Type", stage: s, count: c })),
  ];
  return rows.sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------
// DOCUMENT EXPIRY (reuses the Sprint 17 rule)
// ------------------------------------------------------------

/**
 * The strictest (widest) alert window configured per document
 * type from the ACTIVE DocumentRequirement rows (Sprint 17
 * configuration - nothing below is hardcoded legal text).
 */
async function expiringWindowByType(tx) {
  const reqs = await tx.run(SELECT.from(T.requirement)
    .columns("documentType", "expiryAlertDays")
    .where({ status: "Active" }));
  const alert = new Map();
  for (const r of reqs || []) {
    if (!r.expiryAlertDays || r.expiryAlertDays <= 0) continue;
    const prev = alert.get(r.documentType) || 0;
    if (r.expiryAlertDays > prev) alert.set(r.documentType, r.expiryAlertDays);
  }
  return alert;
}

/**
 * Document counts per type over ACTIVE documents that actually
 * have an expiry date. Same rule as Sprint 17 compliance:
 *   expiry < today              ................. expired
 *   expiry <= today + alertDays ................. expiring
 * (no active requirement with an alert window for the type ->
 * that type has NO expiring window - nothing is invented).
 */
async function documentExpiryOverview(tx, d = today()) {
  const docs = await tx.run(SELECT.from(T.document)
    .columns("documentType", "expiryDate", "status", "verified"));
  const alerts = await expiringWindowByType(tx);
  const stats = new Map(); // type -> {active, expiring, expired}
  for (const doc of docs || []) {
    if (doc.status !== "Active" || !doc.documentType || !doc.expiryDate) continue;
    const s = stats.get(doc.documentType) ||
      { documentType: doc.documentType, activeDocuments: 0, expiringDocuments: 0, expiredDocuments: 0 };
    s.activeDocuments += 1;
    if (doc.expiryDate < d) s.expiredDocuments += 1;
    else {
      const window = alerts.get(doc.documentType) || 0;
      if (window > 0 && doc.expiryDate <= addDays(d, window)) s.expiringDocuments += 1;
    }
    stats.set(doc.documentType, s);
  }
  return [...stats.values()].sort((a, b) =>
    (a.documentType || "").localeCompare(b.documentType || ""));
}

module.exports = {
  T,
  today,
  addDays,
  day,
  inRange,
  countBy,
  workforceStatusCounts,
  headcountByDepartment,
  leaveUsageByType,
  attendanceStatusCounts,
  recruitmentFunnel,
  performanceStatusCounts,
  assetStatusCounts,
  helpdeskStatusCounts,
  exitStatusCounts,
  expiringWindowByType,
  documentExpiryOverview,
};
