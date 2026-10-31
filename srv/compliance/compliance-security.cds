using ComplianceService from './compliance-service';

// ============================================================
// SPRINT 17 - COMPLIANCE SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// PRINCIPLE: "you may see that something is missing, not what the
// document itself contains" - the sensitive bytes stay behind the
// EmployeeService.Documents Download grant (owner / HRAdmin /
// SystemAdmin). This service deals with requirement CONFIGURATION
// and placeholders/counts only.
//
//   * DocumentRequirements (rule catalog): readable by everyone
//     (employees need to know what to hand in), writable by
//     HRAdmin + SystemAdmin only. Changes are audited via the
//     shared audit helper + a requirement history is NOT kept -
//     the shared AuditLog covers it (documented decision).
//   * ComplianceSummaries / ComplianceLines: HR trio + SystemAdmin
//     see everyone; an employee sees ONLY their own rows
//     (self-service "what am I missing"); managers deliberately
//     get NO compliance views - their line of sight remains the
//     general Employee data (same reasoning as geo evidence).
//   * NotifyDocumentExpiries: HRAdmin + SystemAdmin (it creates
//     notifications on behalf of the compliance process).
//   * Deny-by-default applies for any role not listed.
// ============================================================

annotate ComplianceService.ComplianceSummaries with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
];

annotate ComplianceService.ComplianceLines with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
];

annotate ComplianceService.NotifyDocumentExpiries with @restrict: [
    { grant: '*', to: ['HRAdmin', 'SystemAdmin'] },
];

annotate ComplianceService.DocumentRequirements with @restrict: [
    // The rule catalog is public metadata (what is required, not
    // who has what).
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] },
];
