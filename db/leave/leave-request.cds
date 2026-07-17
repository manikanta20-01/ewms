namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from '../employee/employee';
using {ewms.db.leave.LeaveType} from './leave-type';

entity LeaveRequest : managed {
    key ID : UUID;
    leaveNumber : String(20) @assert.unique;
    employee : Association to Employee;
    leaveType : Association to LeaveType;
    fromDate : Date;
    toDate : Date;
    totalDays : Decimal(5, 2);
    reason : type.Description;
    halfDay : Boolean default false;
    halfDayType : enums.HalfDayType;
    emergencyLeave : Boolean default false;
    attachment : String(255);
    status : enums.LeaveStatus default 'Draft';
    remarks : type.Description;
    appliedOn : Timestamp; 
}
