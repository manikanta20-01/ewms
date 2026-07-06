namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from './employee';

entity StatutoryDetail : managed {

    key ID : UUID;
    employee : Association to Employee not null;
    uanNumber : String(20);
    pfNumber : String(30);
    esiNumber : String(25);
    panNumber : String(10);
    aadhaarNumber : String(12);
    isPFApplicable : Boolean default true;
    isESIApplicable : Boolean default false;
    passportNumber : String(20);
    passportExpiry : Date;
    remarks : String(500);
    status : enums.Status default 'Active';
}
