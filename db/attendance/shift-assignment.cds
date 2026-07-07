namespace ewms.db.attendance;

using {managed} from '@sap/cds/common';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.attendance.Shift } from './shift';

entity ShiftAssignment : managed {
    key ID : UUID;
    employee : Association to Employee;
    shift : Association to Shift;
    effectiveFrom : Date not null;
    effectiveTo : Date;
}
