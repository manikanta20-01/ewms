namespace ewms.db.common;
using { managed } from '@sap/cds/common';
using {ewms.db.employee.Employee} from '../employee/employee';

entity AppUsers : managed {
    key ID          : UUID;
    iasUserId       : String(255) @mandatory;   // immutable subject/logon from IAS token, never email
    employee : Association to Employee;
    displayName     : String(150);
    preferredLocale : String(10) default 'en';
    theme           : String(20) default 'light';
    status          : String(20) enum { Active; Inactive; Locked } default 'Active';
    lastLoginAt     : Timestamp;
}