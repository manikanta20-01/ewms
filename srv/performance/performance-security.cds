using PerformanceService from './performance-service';

// ============================================================
// SPRINT 13 - PERFORMANCE SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// No new security framework. Performance data is SENSITIVE:
//
//  * HR (HRExecutive / HRAdmin / SystemAdmin) manages and reads
//    all reviews and goals.
//  * An Employee may READ only their OWN reviews/goals (row-level
//    where clauses) and may add comments to their own reviews.
//  * The assigned REVIEWER sees and works on the reviews assigned
//    to them; the goal ASSIGNEE may drive their goals' lifecycle.
//  * Everyone else - even with access to the service - gets no
//    rows: a plain employee can never read a colleague's
//    performance data.
//  * ApproveReview / CompleteReview are deliberately HR-only; the
//    normal approval path is the generic workflow engine, which
//    enforces its own task access rules (engine-side).
// ============================================================

annotate PerformanceService with @(requires: 'authenticated-user');

annotate PerformanceService.Reviews with @restrict: [
    // HR sees everything.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The reviewer sees the reviews assigned to them; the employee
    // sees their own reviews. Both are row-level restricted.
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'Employee'], where: 'reviewer_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'Employee'], where: 'employee_ID = $user.employeeId' },

    // Master data maintenance is HR work.
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },

    // Lifecycle actions.
    { grant: ['SubmitReview', 'ApproveReview', 'CompleteReview', 'CancelReview'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Reviewer work: start + evaluate the reviews assigned to them.
    { grant: ['StartReview', 'SubmitEvaluation'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['StartReview', 'SubmitEvaluation'],
      to: ['DepartmentManager', 'ProjectManager', 'Employee'],
      where: 'reviewer_ID = $user.employeeId' },
    // The employee comments on their own review.
    { grant: ['AddEmployeeComments'],
      to: ['DepartmentManager', 'ProjectManager', 'Employee'],
      where: 'employee_ID = $user.employeeId' }
];

annotate PerformanceService.Goals with @restrict: [
    // HR sees everything.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The goal owner sees their goals; the assignee (manager)
    // sees the goals they assigned.
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'Employee'], where: 'employee_ID = $user.employeeId' },
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager', 'Employee'], where: 'assignedBy_ID = $user.employeeId' },

    // Master data maintenance is HR work.
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },

    // The assignee drives the goal lifecycle; HR may always do it.
    { grant: ['ActivateGoal', 'CompleteGoal', 'CancelGoal'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['ActivateGoal', 'CompleteGoal', 'CancelGoal'],
      to: ['DepartmentManager', 'ProjectManager', 'Employee'],
      where: 'assignedBy_ID = $user.employeeId' }
];
