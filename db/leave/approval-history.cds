namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';

using {ewms.db.employee.Employee} from '../employee/employee';
using {ewms.db.leave.LeaveRequest} from './leave-request';

entity ApprovalHistory : managed {
    key ID : UUID;
    leaveRequest : Association to LeaveRequest;
    action : type.Name50;
    performedBy : Association to Employee not null;
    performedOn : Timestamp;
    remarks : type.Description;
}
