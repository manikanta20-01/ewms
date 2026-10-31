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
    workLocation : enums.WorkLocation default 'Office';
    workedHours : Decimal(5, 2);
    // breakHours : Decimal(5, 2) default 0;
    lateMinutes : Integer default 0;
    earlyLeavingMinutes : Integer default 0;
    attendanceStatus : enums.AttendanceStatus;
    remarks : String(500);

    // ------------------------------------------------------------
    // SPRINT 16 - OPTIONAL LOCATION EVIDENCE (input-only fields)
    // ------------------------------------------------------------
    // A check-in / check-out REQUEST may carry coordinates + the
    // client-side location time. They are NEVER stored on Attendance
    // (@cds.persistence.skip = not in the database): the geofence
    // validator (srv/geo/geofence-validator.js) evaluates them and
    // writes the ROUNDED evidence into AttendanceLocationEvent
    // (geo module) linked to this attendance row. No coordinates in
    // attendance list responses by construction.
    @cds.persistence.skip latitude : Decimal(9, 6);
    @cds.persistence.skip longitude : Decimal(10, 6);
    @cds.persistence.skip locationTimestamp : Timestamp;
}