namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from '../employee/employee';
using {ewms.db.leave.LeaveType} from './leave-type';

entity LeaveBalance : managed {
    key ID : UUID;
    employee : Association to Employee;
    leaveType : Association to LeaveType;
    year : Integer;
    allocatedDays : Decimal(5, 2);
    usedDays : Decimal(5, 2);
    pendingDays : Decimal(5, 2);
    status : enums.Status default 'Active';
}

