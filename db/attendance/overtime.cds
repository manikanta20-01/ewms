namespace ewms.db.attendance;

using { managed } from '@sap/cds/common';

using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.attendance.Attendance } from './attendance';

entity Overtime : managed {
    key ID              : UUID;
    employee            : Association to Employee not null;
    attendance          : Association to Attendance not null;
    approvedHours       : Decimal(5,2);
    reason              : String(500);
    approvedBy          : Association to Employee;
    approvedDate        : DateTime;
    status              : enums.Status default 'Pending';
}

