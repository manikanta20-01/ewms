using AttendanceService from './attendance-service';

annotate AttendanceService with @(requires: 'authenticated-user');

annotate AttendanceService.Attendances with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager'], where: 'employee.assignments.project.department_ID = $user.departmentId' },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];
annotate AttendanceService.Overtimes with @restrict: [
  { grant: ['READ','CREATE'], to: ['Employee'], where: 'employee_ID = $user.employeeId' },
  { grant: ['READ','UPDATE'], to: ['DepartmentManager'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];
annotate AttendanceService.Shifts with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];

annotate AttendanceService.ShiftAssignments with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];

annotate AttendanceService.WorkSchedules with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];

annotate AttendanceService.Holidays with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];

annotate AttendanceService.HolidayCalendars with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];