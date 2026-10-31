using EngagementService from './engagement-service';

// ============================================================
// SPRINT 18 - ENGAGEMENT SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// PRINCIPLE (same reasoning as every other module): role grants
// in this file are the perimeter, but handlers re-check row
// ownership and lifecycle server-side. Hiding a UI field is not
// security.
//
//   * Survey authoring + lifecycle actions: HRAdmin +
//     SystemAdmin only. Draft surveys and their questions are
//     therefore invisible to unmodified employees by grant.
//   * Published survey METADATA is readable to everyone -
//     otherwise targeted employees could not discover it.
//   * Submit: Employees + admins (audience/eligibility is
//     validated in the handler; the grant only opens the door).
//   * SurveyResponses: the respondent sees their own row.
//     Individual answers have NO entity and NO grant at all -
//     SurveyResults is the only aggregate channel, restricted to
//     HRAdmin + SystemAdmin, and returns aggregate counts only.
//   * Suggestions: employees manage their own rows (self-write
//     guard), reviewers (HRAdmin + HRExecutive + SystemAdmin)
//     see all + decide. Managers deliberately get no feedback
//     access (privacy; same line-of-sight reasoning as HR docs).
//   * Recognitions: everyone authenticated may read the public
//     kudos feed; senders are validated server-side; moderation
//     is HRAdmin + SystemAdmin.
// ============================================================

annotate EngagementService.EngagementSurveys with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] },
];

annotate EngagementService.SurveyQuestions with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] },
];

// Bound actions are restricted through the entity's `actions`
// block (the correct annotate path for entity-bound operations).
annotate EngagementService.EngagementSurveys actions {
    Publish @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Close @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Archive @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
    Submit @restrict: [{
        grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                         'HRExecutive', 'HRAdmin', 'FinanceManager',
                         'PayrollExecutive', 'SystemAdmin'],
    }];
    SurveyResults @restrict: [{ grant: '*', to: ['HRAdmin', 'SystemAdmin'] }];
}

annotate EngagementService.SurveyResponses actions {
    Withdraw @restrict: [{
        grant: '*', to: ['Employee', 'DepartmentManager', 'ProjectManager',
                         'HRExecutive', 'HRAdmin', 'FinanceManager',
                         'PayrollExecutive', 'SystemAdmin'],
    }];
}

annotate EngagementService.Suggestions actions {
    // Reviewers may decide; HRExecutive is included because the
    // HR trio is the documented suggestion-review population.
    Resolve @restrict: [{ grant: '*', to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }];
}

annotate EngagementService.SurveyResponses with @restrict: [
    { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
];

annotate EngagementService.Suggestions with @restrict: [
    // An employee sees and manages THEIR OWN suggestion records;
    // self-write guard keeps CREATE honest (submitter = caller).
    { grant: ['CREATE', 'READ', 'UPDATE'], to: ['Employee'],
      where: 'submittedBy_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager',
                            'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'READ', 'UPDATE'], to: ['HRAdmin', 'SystemAdmin'] },
];

annotate EngagementService.Recognitions with @restrict: [
    // Kudos is a public feed within the company: every role may
    // read. Creation is open to employees; the sender identity +
    // validation are entirely server-side (handler). Moderation
    // (status changes / delete) is admin-only.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                            'HRExecutive', 'HRAdmin', 'FinanceManager',
                            'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE'], to: ['Employee', 'DepartmentManager', 'ProjectManager',
                              'HRExecutive', 'HRAdmin', 'FinanceManager',
                              'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] },
];
