namespace ewms.db.payroll;

using { managed } from '@sap/cds/common';
using ewms.db.common as type from '../common/types';


entity PayrollPeriod : managed {
    key ID : UUID;
    payrollCode : type.BusinessCode;
    month : Integer not null;
    year : Integer not null;
    startDate : Date not null;
    endDate : Date not null;
    workingDays : Decimal(4, 2) not null;
    isLocked : Boolean default false;
    processedOn : Timestamp;
}

