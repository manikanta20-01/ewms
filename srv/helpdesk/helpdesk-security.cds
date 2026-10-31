using HelpdeskService from './helpdesk-service';

// ============================================================
// SPRINT 20 - HR SUPPORT / HELPDESK SECURITY
// (reuses the Sprint 9 roles)
// ------------------------------------------------------------
// Same principle as every module: grants are the perimeter, the
// handlers re-check row ownership, lifecycle states and privacy
// server-side (hiding a UI field is not security).
//
//   * HRTickets: the requester reads OWN rows via a where-clause
//     ($user.employeeId) - so the perimeter itself denies other
//     people's tickets, not just the UI. The HR trio (the support
//     agents) reads all. There are NO UPDATE/DELETE grants for
//     anyone: every lifecycle move is a bound action, so a direct
//     PATCH can never smuggle a status change.
//
//   * Actions: assignment/progress/resolve/wait are agent-only
//     (HR trio); open/close/reopen/comments involve the requester,
//     but the handler re-checks ownership per call.
//
//   * HRTicketComments: the requester may read the comments of
//     their OWN ticket EXCEPT internal notes (handler filter);
//     HR reads all.
//
//   * HRTicketEvents: HR-only. Internal routing detail stays out
//     of requester reads.
//
//   * HRTicketSLAConfigs / OverdueTickets: HR trio only (same
//     line-of-sight rule as Sprint 17/19 reporting).
// ============================================================

annotate HelpdeskService.HRTickets with @restrict: [
    // Requester self-visibility; assigned agents are HR roles and
    // already covered by the HR grant below.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'requester_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Ticket writes: creation only (requester, server-stamped);
    // all other changes through bound actions. NO UPDATE/DELETE
    // grant for anyone, so a direct PATCH can never move a status.
    { grant: ['CREATE'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                              'FinanceManager', 'PayrollExecutive',
                              'HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate HelpdeskService.HRTickets actions {
    Assign         @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Start          @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    WaitForEmployee @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Resolve        @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Close          @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                'FinanceManager', 'PayrollExecutive',
                                                'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Reopen         @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                'FinanceManager', 'PayrollExecutive',
                                                'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    ChangePriority @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    AddComment     @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                  'FinanceManager', 'PayrollExecutive',
                                                  'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
}

annotate HelpdeskService.HRTicketComments with @restrict: [
    // Requesters may read their own ticket's comments; the KIND
    // filter (how many InternalNote rows) is applied by the
    // handler because a static where-clause cannot express it.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'] },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate HelpdeskService.HRTicketEvents with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

// SLA configuration is agent configuration; targets are nullable
// and never defaulted by code.
annotate HelpdeskService.HRTicketSLAConfigs with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

// The handler computes rows itself, so it enforces this too (CAP
// cannot apply security where-clauses to a skip entity).
annotate HelpdeskService.OverdueTickets with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
