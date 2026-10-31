using ReportsService from './reports-service';

// ============================================================
// SPRINT 23 - REPORTS SECURITY
// ------------------------------------------------------------
// Reports are HR/management reporting surfaces; the rows are
// PERSONAL (names, attendance, leaves, document numbers), so:
//
//   * plain employees and managers are denied EVERY report here
//     - their regular per-module services already give them
//     scoped self-service views; piling scoped rows into a new
//     surface would only widen the attack surface;
//   * the row-level reports (Workforce/Attendance/Leave/Assets/
//     DocumentExpiry) stay strictly behind the HR trio +
//     SystemAdmin, matching the role maps of their SOURCE
//     modules (attendance/leave: HR full; assets: HR + finance;
//     documents: HR);
//   * the aggregate-funnel reports (Recruitment/Performance/
//     Helpdesk/Exit) keep the same narrow line-of-sight used in
//     Sprints 12/13/20/21 dashboards;
//   * NO write grant exists anywhere: reports are computed and
//     immutable by construction;
//   * handlers RE-CHECK these roles (computed entities cannot
//     get row policies; same double-lock as the dashboard).
// ============================================================

annotate ReportsService.Workforce with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Attendance with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Leave with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Recruitment with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Performance with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Asset with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'FinanceManager'] },
];
annotate ReportsService.DocumentExpiry with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Helpdesk with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate ReportsService.Exit with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
