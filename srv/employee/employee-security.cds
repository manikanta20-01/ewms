using EmployeeService from './employee-service';

annotate EmployeeService with @(requires: 'authenticated-user');

annotate EmployeeService.Employees with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'ID = $user.employeeId' },
  // { grant: ['READ'], to: ['DepartmentManager'], where: 'department_ID = $user.departmentId' },
  { grant: ['READ'], to: ['HRExecutive','HRAdmin','FinanceManager','SystemAdmin'] },
  { grant: ['READ'], to: ['ProjectManager'], where: 'assignments.project.department_ID = $user.departmentId' },
  { grant: ['READ'], to: ['DepartmentManager'], where: 'assignments.project.department_ID = $user.departmentId' },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate EmployeeService.Designations with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate EmployeeService.Grades with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate EmployeeService.EmployeeAssignments with @restrict: [
  { grant: ['READ'], to: ['DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate EmployeeService.EmployeeHistory with @restrict: [
  { grant: ['READ'], to: ['HRAdmin','HRExecutive','SystemAdmin'] }
];

annotate EmployeeService.Banks with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
  // Updated: Granted CRUD to FinanceManager, HRExecutive, HRAdmin, and SystemAdmin
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['FinanceManager', 'HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

annotate EmployeeService.StatutoryDetails with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ'], to: ['HRAdmin','FinanceManager','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];

annotate EmployeeService.Documents with @restrict: [
  { grant: ['READ','CREATE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  // Sprint 17: employees may correct their own METADATA (issue date,
  // remarks, numbers) on their own documents. Every sensitive field
  // (status, verification, storage, content) is refused by the
  // handler regardless of grants, so this is safe self-service.
  { grant: ['UPDATE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  // READ, CREATE, UPDATE, DELETE for HRAdmin/SystemAdmin. CREATE is
  // required: HR registers statutory documents (contract, PAN scan,
  // ...) on behalf of employees. The create handler's self-write
  // guard lets the HR group bypass the employee_ID ownership check,
  // so this grant cannot be misused by a plain employee.
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] },

  // Sprint 17 - verification / lifecycle / file access. Deliberately
  // HRAdmin + SystemAdmin ONLY (matches the existing READ policy,
  // which has never included HRExecutive for documents). The owner
  // may download their own document's bytes via the where clause.
  { grant: ['Verify','Reject','Archive'], to: ['HRAdmin','SystemAdmin'] },
  { grant: ['Download'], to: ['HRAdmin','SystemAdmin'] },
  { grant: ['Download'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
];

annotate EmployeeService.Educations with @restrict: [
  { grant: ['READ','UPDATE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','HRExecutive','SystemAdmin'] }
];

annotate EmployeeService.Experiences with @restrict: [
  { grant: ['READ','UPDATE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','HRExecutive','SystemAdmin'] }
];