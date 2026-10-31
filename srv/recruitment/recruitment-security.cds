using RecruitmentService from './recruitment-service';

// ============================================================
// SPRINT 12 - RECRUITMENT SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// No new security framework. Recruitment data is CONFIDENTIAL:
//
//  * Candidates and offers are visible to HR / Finance / System
//    administrators only. A normal Employee has NO access here -
//    candidate records are personal data of non-employees.
//  * The hiring manager (DepartmentManager) may READ offers where
//    they are the reporting manager. Their view is additionally
//    masked in code: offeredCTC is blanked unless the caller has
//    an HR/Finance/SystemAdmin role (see handlers/offer-lifecycle.js).
//  * Candidates must never be able to read offer data themselves -
//    they have no user account in EWMS; HR records their decision.
//  * ApproveOffer / RejectOffer are the DIRECT-approval fallback
//    for HR administration; the normal path is the generic
//    workflow engine, which enforces its own task access rules.
//  * ConvertToEmployee is deliberately HRAdmin/SystemAdmin-only:
//    creating employee master data is a sensitive operation.
// ============================================================

annotate RecruitmentService with @(requires: 'authenticated-user');

annotate RecruitmentService.Candidates with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

annotate RecruitmentService.Offers with @restrict: [
    // HR, Finance and SystemAdmin may read all offers (compensation
    // included). The hiring manager gets a masked view - see the
    // after-READ handler in srv/recruitment/handlers/offer-lifecycle.js.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'FinanceManager', 'SystemAdmin'] },
    // The hiring manager may read only the offers they would manage.
    { grant: ['READ'], to: ['DepartmentManager'], where: 'reportingManager_ID = $user.employeeId' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Lifecycle actions.
    { grant: ['SubmitForApproval'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['ApproveOffer', 'RejectOffer'], to: ['HRAdmin', 'SystemAdmin'] },
    { grant: ['SendOffer', 'WithdrawOffer', 'ExpireOffer'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['RecordAcceptance', 'RecordRejection'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

annotate RecruitmentService.OnboardingChecklists with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate RecruitmentService.OnboardingChecklistItems with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate RecruitmentService.OnboardingCases with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The hiring manager may follow the onboarding of their new report.
    { grant: ['READ'], to: ['DepartmentManager'], where: 'reportingManager_ID = $user.employeeId' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['StartOnboarding', 'HoldOnboarding', 'ResumeOnboarding', 'CompleteOnboarding', 'CancelOnboarding'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Employee creation is sensitive: administrators only.
    { grant: ['ConvertToEmployee'], to: ['HRAdmin', 'SystemAdmin'] }
];

// Tasks: the ASSIGNEE works on their own tasks; HR manages all.
annotate RecruitmentService.OnboardingTasks with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager'], where: 'assignee_ID = $user.employeeId' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['StartTask', 'CompleteTask', 'SkipTask', 'BlockTask', 'ReopenTask'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['StartTask', 'CompleteTask'], to: ['Employee', 'DepartmentManager', 'ProjectManager'],
      where: 'assignee_ID = $user.employeeId' }
];

// Documents: submission is HR work; verification is executive work.
annotate RecruitmentService.OnboardingDocumentRequirements with @restrict: [
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['SubmitDocument', 'VerifyDocument', 'RejectDocument', 'WaiveDocument'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];
