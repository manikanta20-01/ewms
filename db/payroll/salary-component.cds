namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as enum from '../common/enums';
using ewms.db.common as type from '../common/types';

entity SalaryComponent : managed {
    key ID : UUID;
    componentCode : String(20) @assert.unique;
    componentName : type.Name100;
    componentType : enum.SalaryComponentType not null;
    calculationType : enum.CalculationType not null;
    taxable : Boolean default true;
    statutory : Boolean default false;
    displayOrder : Integer;
    status : type.Status default 'Active';
}

