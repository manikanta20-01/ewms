namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from '../employee/employee';
using {ewms.db.leave.LeaveRequest} from './leave-request';


entity LeaveApproval : managed {
    key ID : UUID;
    leaveRequest : Association to LeaveRequest not null;
    approver : Association to Employee not null;
    level : Integer;
    decision : enums.ApprovalDecision default 'Pending';
    decisionDate : Timestamp;
    remarks : type.Description;
}