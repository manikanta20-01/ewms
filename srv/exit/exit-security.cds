using ExitService from './exit-service';

// ============================================================
// SPRINT 21 - EXIT MANAGEMENT SECURITY
// (reuses the Sprint 9 roles)
// ------------------------------------------------------------
// Grants are the perimeter; every handler re-checks row
// ownership, exit-type sensitivity, checklist state and item
// authorization server-side (hiding a field is not security).
//
//   * ExitCases:
//       - READ: the departing employee reads OWN rows via a
//         where-clause ($user.employeeId); the HR trio reads all.
//         Managers deliberately get NO line of sight: an exit is
//         sensitive personal data (same reasoning as the
//         Sprint 17/19/20 reporting surfaces).
//       - CREATE: employee classes (self-service; the handler
//         stamps employee = caller) + HR trio (also for others);
//       - NO UPDATE/DELETE grant for ANYONE: status/dates only
//         move through the bound actions, so a direct PATCH can
//         never smuggle a lifecycle change and completed cases
//         cannot be silently rewritten.
//   * ExitChecklistItems: READ for the employee classes (own
//     case rows) + HR; every write goes through the actions
//     (also for HR - seeding is system-driven).
//   * ExitCaseDocuments: READ own case rows + HR; CREATE/DELETE
//     via HR or the case's own employee (handler validates the
//     referenced document); NO UPDATE (immutable links).
//   * ExitEvents: HR-only (internal detail, like HRTicketEvents).
//   * Configuration entities: HR trio CRUD (employees read the
//     checklist config is not needed - items come seeded).
//   * DepartingEmployeeAssets: computed view, HR-only; the
//     handler enforces this too (CAP cannot scope skip entities).
// ============================================================

annotate ExitService.ExitCases with @restrict: [
    // Self-visibility for the departing employee; managers/others
    // are denied at the perimeter.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Creation: self-service + HR (handler decides which exit
    // type may be initiated by whom).
    { grant: ['CREATE'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                              'FinanceManager', 'PayrollExecutive',
                              'HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate ExitService.ExitCases actions {
    Submit              @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                          'FinanceManager', 'PayrollExecutive',
                                                          'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Withdraw            @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                          'FinanceManager', 'PayrollExecutive',
                                                          'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    StartReview         @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    WaiveNotice         @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    ChangeApprovedDate  @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    StartClearance      @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    MarkReadyForSeparation @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    CompleteExit        @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    Correct             @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    RecordFinalSettlement @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin',
                                                          'FinanceManager', 'PayrollExecutive'] }];
    Reconsider          @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
}

annotate ExitService.ExitChecklistItems with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'exitCase.employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate ExitService.ExitChecklistItems actions {
    CompleteItem @restrict: [{ grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                                                'FinanceManager', 'PayrollExecutive',
                                                'HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
    SkipItem     @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
}

annotate ExitService.ExitCaseDocuments with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'FinanceManager', 'PayrollExecutive'],
      where: 'exitCase.employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Linking/unlinking: the employee on their own case + HR.
    // (The handler re-validates the DOCUMENT's ownership.)
    { grant: ['CREATE'], to: ['Employee', 'HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin', 'Employee'] },
];

annotate ExitService.ExitEvents with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate ExitService.ExitClearanceTemplates with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate ExitService.ExitClearanceTemplateItems with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate ExitService.ExitNoticePolicies with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

// The handler computes rows itself, so it enforces this too (CAP
// cannot apply security where-clauses to a skip entity).
annotate ExitService.DepartingEmployeeAssets with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];
