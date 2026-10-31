const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { hasRole } = require("../../common/auth/authorization");
const A = require("../../common/utils/analytics-queries");

// ============================================================
// SPRINT 22 - DASHBOARD READ HANDLERS (computed, no table)
// ------------------------------------------------------------
// Each entity is one .on("READ") that runs the matching SHARED
// analytics helper (analytics-queries.js) - nothing metric-like
// is computed here, so Sprint 23 reports can NEVER drift away
// from these numbers.
//
// Security note: computed entities cannot get row-level where
// policies from grants, so the management-role check is
// REPEATED here (belt + suspenders, same pattern as the
// helpdesk OverdueTickets handler).
// ============================================================

const MANAGEMENT = ["DepartmentManager", "ProjectManager", "HRExecutive",
  "HRAdmin", "FinanceManager", "PayrollExecutive", "SystemAdmin"];

module.exports = (srv) => {
  const q = srv.entities;

  // Cheap central gate for every dashboard read.
  const asManagement = (req) => {
    if (!hasRole(req, ...MANAGEMENT)) {
      req.reject(403, "The dashboard is a management view. Ask HR for access.");
      return false;
    }
    return true;
  };

  srv.on("READ", q.WorkforceStatus, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    const counts = await A.workforceStatusCounts(tx);
    return counts.map((c) => ({ status: c.status, employeeCount: c.count }));
  });

  srv.on("READ", q.HeadcountByDepartment, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.headcountByDepartment(tx);
  });

  srv.on("READ", q.LeaveTypeUsage, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.leaveUsageByType(tx);
  });

  srv.on("READ", q.AttendanceByStatus, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    const counts = await A.attendanceStatusCounts(tx);
    return counts.map((c) => ({
      attendanceStatus: c.attendanceStatus,
      occurrenceCount: c.count,
    }));
  });

  srv.on("READ", q.RecruitmentFunnel, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.recruitmentFunnel(tx);
  });

  srv.on("READ", q.PerformanceStatus, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.performanceStatusCounts(tx);
  });

  srv.on("READ", q.AssetSummary, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.assetStatusCounts(tx);
  });

  srv.on("READ", q.HelpdeskSummary, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.helpdeskStatusCounts(tx);
  });

  srv.on("READ", q.ExitSummary, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.exitStatusCounts(tx);
  });

  srv.on("READ", q.DocumentExpiryOverview, async (req) => {
    if (!asManagement(req)) return [];
    const tx = cds.transaction(req);
    return A.documentExpiryOverview(tx);
  });
};
