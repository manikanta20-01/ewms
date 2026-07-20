const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { required } = require("../../common/utils/validation");

module.exports = (srv) => {
  const { LeaveApproval, LeaveRequest, LeaveBalance, ApprovalHistory } =
    srv.entities;

  // // ========
  // // CREATE
  // // ========
  srv.before("CREATE", "LeaveApprovals", async (req) => {
    const tx = cds.transaction(req);
    const { leaveRequest_ID, approver_ID, level } = req.data;

    // 1. Mandatory Input Fields Verification
    required(req, "leaveRequest_ID", "Leave Request Reference");
    required(req, "approver_ID", "Approver Reference");
    required(req, "level", "Approval Level");

    // 2. Structural Integrity: Validate Leave Request Existence via Direct DB (Bypasses UI Locks)[cite: 1, 3]
    const requestExists = await tx.run(
      SELECT.one
        .from("ewms.db.leave.LeaveRequest")
        .where({ ID: leaveRequest_ID }),
    );
    if (!requestExists)
      return req.error(404, "Linked Leave Request records do not exist.");

    // 3. Structural Integrity: Validate Approver Existence via Direct DB[cite: 1, 3]
    const approverExists = await tx.run(
      SELECT.one
        .from("ewms.db.employee.Employee")
        .where({ ID: approver_ID, status: "Active" }),
    );
    if (!approverExists)
      return req.error(
        404,
        "Assigned Approver employee record is either inactive or invalid.",
      );

    req.data.decision = req.data.decision || "Pending";
  });

  // // ========
  // // UPDATE
  // // ========
  srv.before("UPDATE", "LeaveApprovals", async (req) => {
    const tx = cds.transaction(req);
    const { decision, remarks } = req.data;

    // 1. Fetch current live workflow state directly from database boundaries[cite: 1]
    const currentApproval = await tx.run(
      SELECT.one.from("ewms.db.leave.LeaveApproval").where({ ID: req.data.ID }),
    );
    if (!currentApproval)
      return req.error(404, "Workflow record reference not found.");

    if (currentApproval.decision !== "Pending") {
      return req.error(
        400,
        "Prohibited operation: A final decision has already been saved for this workflow stage.",
      );
    }

    // 2. Strict Access Control: Ensure only the assigned approver can submit choices
    if (req.user && req.user.id !== currentApproval.approver_ID) {
      return req.error(
        403,
        "Access Denied: You are not authorized to sign off on this approval routing stage.",
      );
    }

    // 3. Business Rule: Mandate remarks on absolute rejections[cite: 6]
    if (decision === "Rejected" && (!remarks || remarks.trim() === "")) {
      return req.error(
        400,
        "MNC Policy Requirement: Explicit remarks/reasons must be filled out for any leave rejection.",
      );
    }

    // 4. Processing State Transitions Engine
    if (decision === "Approved" || decision === "Rejected") {
      req.data.decisionDate = new Date().toISOString();

      const leaveReq = await tx.run(
        SELECT.one
          .from("ewms.db.leave.LeaveRequest")
          .where({ ID: currentApproval.leaveRequest_ID }),
      );
      if (!leaveReq)
        return req.error(
          404,
          "Associated leave application record could not be read.",
        );

      const leaveYear = new Date(leaveReq.fromDate).getFullYear();

      // Handle Rejection Branch[cite: 6]
      if (decision === "Rejected") {
        await tx.run(
          UPDATE(LeaveRequest)
            .set({ status: "Rejected", remarks: remarks })
            .where({ ID: leaveReq.ID }),
        );

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
            action: "Rejected",
            performedBy_ID: currentApproval.approver_ID,
            performedOn: new Date().toISOString(),
            remarks: remarks,
          }),
        );
      }

      // Handle Approval Branch[cite: 6]
      else if (decision === "Approved") {
        const nextStage = await tx.run(
          SELECT.one.from(LeaveApproval).where({
            leaveRequest_ID: leaveReq.ID,
            level: { ">": currentApproval.level },
            decision: "Pending",
          }),
        );

        if (nextStage) {
          await tx.run(
            UPDATE(LeaveRequest)
              .set({ status: "Pending" })
              .where({ ID: leaveReq.ID }),
          );
        } else {
          await tx.run(
            UPDATE(LeaveRequest)
              .set({ status: "Approved" })
              .where({ ID: leaveReq.ID }),
          );

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

          await tx.run(
            INSERT.into("ewms.db.attendance.Attendance").entries({
              ID: cds.utils.uuid(),
              employee_ID: leaveReq.employee_ID,
              attendanceDate: leaveReq.fromDate, // Standard alignment configuration
              attendanceStatus: "Leave",
              remarks: `System Sync: Approved Leave Request ${leaveReq.leaveNumber}`,
            }),
          );
        }

        await tx.run(
          INSERT.into(ApprovalHistory).entries({
            ID: cds.utils.uuid(),
            leaveRequest_ID: leaveReq.ID,
            action: "Approved",
            performedBy_ID: currentApproval.approver_ID,
            performedOn: new Date().toISOString(),
            remarks: remarks || "Approved at this workflow stage.",
          }),
        );
      }
    }
  });

  // // =======
  // // DELETE
  // // ========
  srv.before("DELETE", "LeaveApprovals", async (req) => {
    return req.error(
      400,
      "Altering an active immutable multi-level workflow registry is prohibited.",
    );
  });
};
