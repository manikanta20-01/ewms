using { ewms.db.leave as leave } from '../../db/schema';service LeaveService {
    entity LeaveTypes as projection on leave.LeaveType;

    // SPRINT 10: LeaveRequests now carries the generic workflow
    // binding. The legacy LeaveApprovals flow below stays fully
    // functional - starting a workflow is OPT-IN per request.
    entity LeaveRequests as projection on leave.LeaveRequest actions {
        // Starts the GENERIC workflow (Sprint 10 engine) for this
        // leave request. The engine picks the ACTIVE
        // WorkflowDefinition for ewms.db.leave.LeaveRequest.
        action StartWorkflow(summary : String(255)) returns String;
    };

    entity LeavePolicies as projection on leave.LeavePolicy;
    entity LeaveBalances as projection on leave.LeaveBalance;
    entity LeaveApprovals as projection on leave.LeaveApproval;
    entity ApprovalHistories as projection on leave.ApprovalHistory;  
}
