namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';
using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.payroll.PayrollPeriod } from './payroll-period';
using { ewms.db.payroll.PayrollDetail } from './payroll-detail';

entity PayrollProcess : managed {
    key ID              : UUID;
    payrollPeriod       : Association to PayrollPeriod not null;
    employee            : Association to Employee not null;
    workingDays         : Decimal(5,2);
    presentDays         : Decimal(5,2);
    lopDays             : Decimal(5,2);
    grossSalary         : Decimal(15,2);
    totalDeductions     : Decimal(15,2);
    netSalary           : Decimal(15,2);
    processStatus       : enums.ProcessStatus default 'Pending'; // <--- Field name in CDS
    details             : Composition of many PayrollDetail on details.payrollProcess = $self;
}