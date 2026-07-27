namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using { ewms.db.payroll.PayrollProcess } from './payroll-process';

entity Payslip : managed {
    key ID              : UUID;
    payslipNumber       : String(40) @assert.unique;
    payrollProcess      : Association to PayrollProcess not null;
    generatedOn         : Timestamp not null;
    publishedOn         : Timestamp;
    // downloadCount       : Integer default 0;
    remarks             : String(255);
}
