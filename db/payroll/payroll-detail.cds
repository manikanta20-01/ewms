namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using { ewms.db.payroll.PayrollProcess } from './payroll-process';
using { ewms.db.payroll.SalaryComponent } from './salary-component';

entity PayrollDetail : managed {
    key ID              : UUID;
    payrollProcess      : Association to PayrollProcess not null;
    salaryComponent     : Association to SalaryComponent not null;
    rate                : Decimal(15, 2) default 0.00;
    quantity            : Decimal(5, 2) default 1.00;
    formula             : String(255);
    calculatedAmount    : Decimal(15, 2) not null;
    remarks             : String(255);
}

