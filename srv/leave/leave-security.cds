using LeaveService from './leave-service';

annotate LeaveService with @(requires: 'authenticated-user');

annotate LeaveService.LeaveRequests with @restrict: [
  { grant: ['READ','CREATE','UPDATE','DELETE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager'], where: 'employee.assignments.project.department_ID = $user.departmentId' },  
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] },
  // SPRINT 10: generic workflow start. The bound action handler
  // (srv/leave/handlers/leave-workflow.js) additionally enforces
  // that the caller owns the leave request (or is HR/SystemAdmin).
  { grant: ['StartWorkflow'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] }
];
annotate LeaveService.LeaveApprovals with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'leaveRequest.employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager','HRExecutive'] },
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] },
  // Row-level: the designated APPROVER of this stage is the one
  // who may record their decision - decision is only ever set
  // through the approver's own UPDATE of the stage assigned to
  // them (approver_ID set automatically when the approval rows
  // are created). HR keeps full unrestricted CRUD above.
  { grant: ['READ','UPDATE'], to: ['Employee'], where: 'approver_ID = $user.employeeId' }
];
annotate LeaveService.LeaveBalances with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] }
];
annotate LeaveService.LeaveTypes with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate LeaveService.LeavePolicies with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] }
];
annotate LeaveService.ApprovalHistories with @restrict: [
  { grant: ['READ'], to: ['HRAdmin','DepartmentManager','SystemAdmin'] }
];