const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { required } = require("../../common/utils/validation");

module.exports = (srv) => {
  const { LeaveApproval, LeaveRequest, LeaveBalance, ApprovalHistory } =
    srv.entities;

  // ============================================================
  // UPDATE - Multi-Level Approval Routing (Level 1: Mgr, Level 2: HR)
  // ============================================================
  srv.before("UPDATE", "LeaveApprovals", async (req) => {
    const tx = cds.transaction(req); // 👈 Correct way to get the transaction context
    const { decision, remarks } = req.data;
    const targetId = req.data.ID || req.params?.[0]?.ID || req.params?.[0];

    // 1. Fetch current live workflow state
    const currentApproval = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveApproval").where({ ID: targetId }),
    );

    if (!currentApproval) {
      return req.error(404, "Workflow approval record not found.");
    }

    if (currentApproval.decision !== "Pending") {
      return req.error(
        400,
        "Prohibited operation: A final decision has already been submitted for this stage.",
      );
    }

    // 2. Mandatory Rejection Remarks Guardrail
    if (decision === "Rejected" && (!remarks || remarks.trim() === "")) {
      return req.error(
        400,
        "Policy Requirement: Explicit remarks/reasons are required for leave rejection.",
      );
    }

    if (decision === "Approved" || decision === "Rejected") {
      req.data.decisionDate = new Date().toISOString();

      const leaveReq = await tx.run(
        SELECT.one
          .from("ewms.db.leave.LeaveRequest")
          .where({ ID: currentApproval.leaveRequest_ID }),
      );

      if (!leaveReq) {
        return req.error(
          404,
          "Associated leave application record could not be found.",
        );
      }

      const leaveYear = new Date(leaveReq.fromDate).getFullYear();

      // --------------------------------------------------------
      // REJECTION BRANCH (Applies to any level)
      // --------------------------------------------------------
      if (decision === "Rejected") {
        await tx.run(
          UPDATE(LeaveRequest)
            .set({ status: "Rejected", remarks: remarks })
            .where({ ID: leaveReq.ID }),
        );

        // Revert pending days on rejection
        await tx.run(
          UPDATE(LeaveBalance)
            .set({ pendingDays: { "-=": leaveReq.totalDays } })
            .where({
              employee_ID: leaveReq.employee_ID,
              leaveType_ID: leaveReq.leaveType_ID,
              year: leaveYear,
            }),
        );

        await tx.run(
          INSERT.into(ApprovalHistory).entries({
            ID: cds.utils.uuid(),
            leaveRequest_ID: leaveReq.ID,
            action: `Rejected (Level ${currentApproval.level})`,
            performedBy_ID: currentApproval.approver_ID,
            performedOn: new Date().toISOString(),
            remarks: remarks,
          }),
        );
      }

      // --------------------------------------------------------
      // APPROVAL BRANCH (Level 1: Manager -> Level 2: HR)
      // --------------------------------------------------------
      else if (decision === "Approved") {
        // Check if a higher approval stage (Level 2) exists
        const nextStage = await tx.run(
          SELECT.one.from("ewms.db.leave.LeaveApproval").where({
            leaveRequest_ID: leaveReq.ID,
            level: { ">": currentApproval.level },
            decision: "Pending",
          }),
        );

        if (nextStage) {
          // LEVEL 1 APPROVED: Keep Leave Request in Pending status for Level 2 (HR)
          await tx.run(
            UPDATE(LeaveRequest)
              .set({
                status: "Pending",
                remarks: "Level 1 Approved. Pending HR (Level 2) Approval.",
              })
              .where({ ID: leaveReq.ID }),
          );
        } else {
          // LEVEL 2 APPROVED (HR Final Approval): Finalize Leave Request
          await tx.run(
            UPDATE(LeaveRequest)
              .set({ status: "Approved", remarks: remarks || "Approved by HR" })
              .where({ ID: leaveReq.ID }),
          );

          // Deduct from Leave Balance
          await tx.run(
            UPDATE(LeaveBalance)
              .set({
                pendingDays: { "-=": leaveReq.totalDays },
                usedDays: { "+=": leaveReq.totalDays },
              })
              .where({
                employee_ID: leaveReq.employee_ID,
                leaveType_ID: leaveReq.leaveType_ID,
                year: leaveYear,
              }),
          );

          // Auto-sync into Attendance module
          await tx.run(
            INSERT.into("ewms.db.attendance.Attendance").entries({
              ID: cds.utils.uuid(),
              employee_ID: leaveReq.employee_ID,
              attendanceDate: leaveReq.fromDate,
              attendanceStatus: "Leave",
              remarks: `System Sync: Approved Leave Request ${leaveReq.leaveNumber}`,
            }),
          );
        }

        // Log to Approval History
        await tx.run(
          INSERT.into(ApprovalHistory).entries({
            ID: cds.utils.uuid(),
            leaveRequest_ID: leaveReq.ID,
            action: `Approved (Level ${currentApproval.level})`,
            performedBy_ID: currentApproval.approver_ID,
            performedOn: new Date().toISOString(),
            remarks: remarks || `Approved at Level ${currentApproval.level}`,
          }),
        );
      }
    }
  });
};
