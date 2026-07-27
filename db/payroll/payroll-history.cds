namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';
using { ewms.db.payroll.PayrollProcess } from './payroll-process';
using { ewms.db.employee.Employee } from '../employee/employee';

entity PayrollHistory : managed {
    key ID              : UUID;
    payrollProcess      : Association to PayrollProcess not null;
    action              : enums.PayrollAction not null;
    performedBy         : Association to Employee not null;
    performedOn         : Timestamp not null;
    remarks             : String(255);
}