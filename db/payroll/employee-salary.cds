namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';
using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.payroll.SalaryStructure } from './salary-structure';

entity EmployeeSalary : managed {
    key ID : UUID;
    employee : Association to Employee;
    salaryStructure : Association to SalaryStructure;
    monthlyCTC : Decimal(15, 2) not null;
    effectiveFrom : Date not null;
    effectiveTo : Date;
    status : enums.Status default 'Active';
}

