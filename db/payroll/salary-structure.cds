namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';
using { ewms.db.payroll.SalaryStructureItem } from './salary-structure-item';
using {ewms.db.employee.Grade} from '../employee/grade';
using {ewms.db.employee.Designation} from '../employee/designation';

entity SalaryStructure : managed {
    key ID              : UUID;
    structureCode       : String(20);
    structureName       : String(100) not null;
    grade               : Association to Grade;
    designation         : Association to Designation;
    currency            : enums.CurrencyType default 'INR';
    effectiveFrom       : Date not null;
    effectiveTo         : Date;
    status              : enums.Status default 'Active';
    items               : Composition of many SalaryStructureItem on items.salaryStructure = $self;
}

