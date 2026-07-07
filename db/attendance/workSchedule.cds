namespace ewms.db.attendance;

using {managed} from '@sap/cds/common';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.attendance.Shift } from './shift';

entity WorkSchedule : managed {
    key ID          : UUID;
    employee        : Association to Employee not null;
    shift           : Association to Shift not null;
    scheduleDate    : Date not null;
    remarks         : String(500);
}

