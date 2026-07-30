using PayrollService from './payroll-service';

annotate PayrollService with @(requires: 'authenticated-user');

annotate PayrollService.PayrollPeriods with @restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['PayrollExecutive', 'SystemAdmin'] },
  { grant: ['READ'], to: ['FinanceManager', 'HRAdmin'] }
];

annotate PayrollService.PayrollProcesses with @restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['PayrollExecutive', 'SystemAdmin'] },
  { grant: ['READ'], to: ['FinanceManager', 'HRAdmin'] }
];

annotate PayrollService.EmployeeSalaries with @restrict: [
  { grant: ['READ'], to: ['FinanceManager', 'HRAdmin', 'SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate PayrollService.Payslips with @restrict: [
  { grant: ['READ'], to: ['Employee'], where: 'payrollProcess.employee_ID = $user.employeeId' },
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'PayrollExecutive', 'SystemAdmin'] }
];

annotate PayrollService.PayrollHistories with @restrict: [
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] }
];

annotate PayrollService.PayrollDetails with @restrict: [
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] }
];

annotate PayrollService.SalaryComponents with @restrict: [
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate PayrollService.SalaryStructures with @restrict: [
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate PayrollService.SalaryStructureItems with @restrict: [
  { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin', 'SystemAdmin'] }
];