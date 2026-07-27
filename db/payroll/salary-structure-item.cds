namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using { ewms.db.payroll.SalaryStructure } from './salary-structure';
using { ewms.db.payroll.SalaryComponent } from './salary-component';

entity SalaryStructureItem : managed {
    key ID              : UUID;
    salaryStructure     : Association to SalaryStructure not null;
    salaryComponent     : Association to SalaryComponent not null;
    amount              : Decimal(15, 2) default 0.00;
    percentage          : Decimal(5, 2) default 0.00;
    formula             : String(255);
}