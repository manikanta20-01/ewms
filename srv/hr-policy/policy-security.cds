using HRPolicyService from './hr-policy-service';

// ============================================================
// SPRINT 19 - HR POLICY SECURITY (reuses the Sprint 9 roles)
// ------------------------------------------------------------
// Same principle as every module: grants are the perimeter, the
// handlers re-check row ownership, lifecycle states and
// applicability server-side (hiding a UI field is not security).
//
//   * Policies (identity/applicability): READ for every
//     authenticated role (the header carries no confidential
//     content), writes for the HR trio only, and handlers
//     freeze the header once a version leaves Draft.
//
//   * PolicyVersions: the HR trio sees every version; everyone
//     else is grant-gated to status = Published AND then
//     applicability-filtered in the handler. Drafts / reviews /
//     approved-but-unpublished versions are invisible by grant,
//     not just by UI.
//
//   * Lifecycle actions: authoring/submitting for the HR trio
//     (plus the policy owner), approve/reject/publish/
//     withdraw/archive for HRAdmin + SystemAdmin only.
//
//   * Acknowledge: available to employees and managers; the
//     applicability and effectiveness checks live in the
//     handler.
//
//   * Acknowledgment RECORDS: an employee sees ONLY own rows
//     ($user.employeeId where-clause), the HR trio reports; NO
//     CREATE/UPDATE/DELETE grant for anyone - records are only
//     created by the Acknowledge action and are immutable.
//
//   * OutstandingAcknowledgments + SendPolicyReminders: the HR
//     trio only (same line-of-sight rule as Sprint 17
//     compliance reporting; managers get no cross-employee
//     acknowledgment data).
// ============================================================

annotate HRPolicyService.Policies with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate HRPolicyService.PolicyVersions with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'status = ''Published''' },
];

annotate HRPolicyService.Policies actions {
    CreateVersion @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
}

annotate HRPolicyService.PolicyVersions actions {
    SubmitForReview @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Approve @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Reject @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Publish @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Withdraw @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Archive @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Acknowledge @restrict: [{
        grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                         'HRExecutive', 'HRAdmin', 'FinanceManager',
                         'PayrollExecutive', 'SystemAdmin'],
    }];
}

annotate HRPolicyService.PolicyAcknowledgments with @restrict: [
    // Employees ONLY their own rows; the HR trio reports; no
    // write grants at all (records immutable by design).
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate HRPolicyService.OutstandingAcknowledgments with @restrict: [
    // The handler enforces this too (it computes rows itself, so
    // CAP cannot apply security where-clauses to it).
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate HRPolicyService.SendPolicyReminders with @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
