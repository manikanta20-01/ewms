namespace ewms.db.attendance;

using {managed} from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from '../employee/employee';
using {ewms.db.attendance.Shift} from './shift';

entity Attendance : managed {
    key ID : UUID;
    employee : Association to Employee not null;
    attendanceDate : Date not null;
    shift : Association to Shift;
    checkIn : Time;
    checkOut : Time;
    workedHours : Decimal(5, 2);
    // breakHours : Decimal(5, 2) default 0;
    lateMinutes : Integer default 0;
    earlyLeavingMinutes : Integer default 0;
    attendanceStatus : enums.AttendanceStatus;
    remarks : String(500);
}
