namespace ewms.db.employee;
using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from './employee';

entity Experience : managed {
    key ID                : UUID;
    employee              : Association to Employee not null;
    companyName           : String(150);
    designation           : String(100);
    employmentType        : enums.EmploymentType default 'Permanent';
    joiningDate           : Date;
    relievingDate         : Date;
    currentlyWorking      : Boolean default false;
    totalExperience : Decimal(5,2);
    lastSalary            : Decimal(15,2);
    currency              : enums.CurrencyType;      
    location              : String(100);
    reasonForLeaving      : type.Description;
    remarks               : type.Description;
    status                : enums.Status default 'Active';
}
