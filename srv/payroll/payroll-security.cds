using PayrollService from './payroll-service';

annotate PayrollService with @(requires: 'authenticated-user');

// 1. Payroll Periods
annotate PayrollService.PayrollPeriods with @restrict: [
    { grant: ['READ'],                               to: ['FinanceManager', 'HRAdmin', 'SystemAdmin', 'PayrollExecutive'] },
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'],  to: ['PayrollExecutive', 'SystemAdmin'] },
    { grant: ['ProcessPayroll'],                      to: ['PayrollExecutive', 'SystemAdmin'] },
    { grant: ['ApprovePayrollBatch'],                 to: ['FinanceManager', 'SystemAdmin'] },
    { grant: ['LockPayroll'],                         to: ['FinanceManager', 'SystemAdmin'] },
    { grant: ['UnlockPayroll'],                       to: ['SystemAdmin'] }
];

// 2. Payroll Processes
annotate PayrollService.PayrollProcesses with @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['PayrollExecutive', 'SystemAdmin'] },
    { grant: ['READ'],                               to: ['FinanceManager', 'HRAdmin'] }
];

// 3. Employee Salaries
annotate PayrollService.EmployeeSalaries with @restrict: [
    { grant: ['READ'],                         to: ['FinanceManager', 'HRAdmin', 'SystemAdmin'] },
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

// 4. Payslips (Row-Level Security)
annotate PayrollService.Payslips with @restrict: [
    { grant: ['READ'],                         to: ['Employee'], where: 'payrollProcess.employee_ID = $user.employeeId' },
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'PayrollExecutive', 'SystemAdmin'] }
];

// 5. Payroll Histories & Details
annotate PayrollService.PayrollHistories with @restrict: [
    { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] }
];

annotate PayrollService.PayrollDetails with @restrict: [
    { grant: ['READ'], to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] }
];

// 6. Salary Components, Structures & Structure Items
annotate PayrollService.SalaryComponents with @restrict: [
    { grant: ['READ'],                         to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate PayrollService.SalaryStructures with @restrict: [
    { grant: ['READ'],                         to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate PayrollService.SalaryStructureItems with @restrict: [
    { grant: ['READ'],                         to: ['HRAdmin', 'FinanceManager', 'SystemAdmin'] },
    { grant: ['CREATE', 'READ', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];