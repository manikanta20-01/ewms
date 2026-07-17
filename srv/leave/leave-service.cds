using { ewms.db.leave as leave } from '../../db/schema';

service LeaveService {
    entity LeaveTypes as projection on leave.LeaveType;
    entity LeaveRequests as projection on leave.LeaveRequest;
    entity LeavePolicies as projection on leave.LeavePolicy;
    entity LeaveBalances as projection on leave.LeaveBalance;
    entity LeaveApprovals as projection on leave.LeaveApproval;
    entity ApprovalHistories as projection on leave.ApprovalHistory;   
}
