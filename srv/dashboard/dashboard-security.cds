using DashboardService from './dashboard-service';

// ============================================================
// SPRINT 22 - DASHBOARD SECURITY
// ------------------------------------------------------------
// The dashboard is aggregated (no personal rows) but it is a
// MANAGEMENT view, not employee self-service: plain employees
// deliberately get no access (an all-employee headcount or an
// all-department ticket list is still organizational
// information). Readers = the HR/finance/management roles +
// SystemAdmin, same line-of-sight family as the reporting
// surfaces of Sprints 17/19/20.
//
// Handlers re-check the same roles server-side - annotations
// alone are not the enforcement for computed entities (CAP
// cannot apply row policies to entities with no back-end
// table, so the handler is the second lock, like
// OverdueTickets in the helpdesk module).
// ============================================================

annotate DashboardService.WorkforceStatus with @restrict: [
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'HRExecutive',
                            'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
];
annotate DashboardService.HeadcountByDepartment with @restrict: [
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'HRExecutive',
                            'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
];
annotate DashboardService.LeaveTypeUsage with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'FinanceManager', 'SystemAdmin'] },
];
annotate DashboardService.AttendanceByStatus with @restrict: [
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'HRExecutive',
                            'HRAdmin', 'FinanceManager', 'SystemAdmin'] },
];
annotate DashboardService.RecruitmentFunnel with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate DashboardService.PerformanceStatus with @restrict: [
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'HRExecutive',
                            'HRAdmin', 'SystemAdmin'] },
];
annotate DashboardService.AssetSummary with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'FinanceManager', 'SystemAdmin'] },
];
annotate DashboardService.HelpdeskSummary with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate DashboardService.ExitSummary with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
annotate DashboardService.DocumentExpiryOverview with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
