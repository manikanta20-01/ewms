using LeaveService from './leave-service';

annotate LeaveService with @(requires: 'authenticated-user');

annotate LeaveService.LeaveRequests with @restrict: [
  { grant: ['READ','CREATE','UPDATE','DELETE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager'], where: 'employee.assignments.project.department_ID = $user.departmentId' },  
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] }
];
annotate LeaveService.LeaveApprovals with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'leaveRequest.employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager','HRExecutive'] },
  { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin','SystemAdmin'] }
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