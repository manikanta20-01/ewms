const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const engine = require("../../workflow/handlers/workflow-engine");
const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");

// ============================================================
// SPRINT 10 - LEAVE <-> GENERIC WORKFLOW INTEGRATION
// ------------------------------------------------------------
// This file connects the EXISTING Leave module (Sprint 7) to the
// new GENERIC workflow engine. It deliberately does NOT rewrite
// the legacy two-level LeaveApprovals flow, which stays fully
// functional; starting the generic workflow is an OPT-IN action
// per leave request.
//
// Integration contract (see business-callbacks.js):
//
//   * Bound action  : StartWorkflow on LeaveRequests
//                     (declared in leave-service.cds) - ownership
//                     is checked here, then the generic engine's
//                     startWorkflow runs with LeaveRequest context.
//
//   * applyDecision : when the instance reaches a final status the
//                     LeaveRequest status is synced (Approved /
//                     Rejected / Cancelled) and, on final approval,
//                     the same balance + attendance syncs the
//                     legacy flow performs are executed.
//
//   * applyRework   : SendBack returns the request to 'Draft' so
//                     the employee can edit and resubmit.
//
//   * applyResubmit : resubmission moves the request back to
//                     'Pending' (balance stays reserved because
//                     it was never released during Rework).
// ============================================================

const LEAVE_REQUEST_ENTITY = "ewms.db.leave.LeaveRequest";
const LEAVE_BALANCE_ENTITY = "ewms.db.leave.LeaveBalance";
const ATTENDANCE_ENTITY = "ewms.db.attendance.Attendance";

// ------------------------------------------------------------
// Business callbacks for the generic engine
// ------------------------------------------------------------

registerCallbacks(LEAVE_REQUEST_ENTITY, {
  /**
   * Final workflow decision -> sync the LeaveRequest status.
   */
  applyDecision: async (tx, instance, decision, comments) => {
    const leaveReq = await tx.run(
      SELECT.one.from(LEAVE_REQUEST_ENTITY).where({ ID: instance.businessObjectId }),
    );
    if (!leaveReq) return; // leave request deleted meanwhile

    if (decision === "Approved") {
      // Final approval: consume reserved balance + attendance sync
      // (same accounting rules as the legacy Level-2 approval).
      const leaveYear = new Date(leaveReq.fromDate).getFullYear();

      await tx.run(
        UPDATE(LEAVE_BALANCE_ENTITY)
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
        INSERT.into(ATTENDANCE_ENTITY).entries({
          ID: cds.utils.uuid(),
          employee_ID: leaveReq.employee_ID,
          attendanceDate: leaveReq.fromDate,
          attendanceStatus: "Leave",
          remarks: `Workflow Sync: Approved Leave Request ${leaveReq.leaveNumber}`,
        }),
      );

      await tx.run(
        UPDATE(LEAVE_REQUEST_ENTITY)
          .set({ status: "Approved", remarks: comments || "Approved via workflow." })
          .where({ ID: leaveReq.ID }),
      );
    } else if (decision === "Rejected") {
      // Release the reserved pending days.
      const leaveYear = new Date(leaveReq.fromDate).getFullYear();
      await tx.run(
        UPDATE(LEAVE_BALANCE_ENTITY)
          .set({ pendingDays: { "-=": leaveReq.totalDays } })
          .where({
            employee_ID: leaveReq.employee_ID,
            leaveType_ID: leaveReq.leaveType_ID,
            year: leaveYear,
          }),
      );

      await tx.run(
        UPDATE(LEAVE_REQUEST_ENTITY)
          .set({ status: "Rejected", remarks: comments })
          .where({ ID: leaveReq.ID }),
      );
    } else if (decision === "Cancelled") {
      // Release the balance reservation made at request creation
      // (mirrors the legacy cancellation logic in leave-request.js).
      // Only still-open requests hold a reservation: 'Approved'
      // requests cannot reach this branch because their workflow
      // instance is finalized.
      if (leaveReq.status === "Pending" || leaveReq.status === "Draft") {
        const leaveYear = new Date(leaveReq.fromDate).getFullYear();
        await tx.run(
          UPDATE(LEAVE_BALANCE_ENTITY)
            .set({ pendingDays: { "-=": leaveReq.totalDays } })
            .where({
              employee_ID: leaveReq.employee_ID,
              leaveType_ID: leaveReq.leaveType_ID,
              year: leaveYear,
            }),
        );
      }
      await tx.run(
        UPDATE(LEAVE_REQUEST_ENTITY)
          .set({ status: "Cancelled", remarks: comments || "Workflow cancelled." })
          .where({ ID: leaveReq.ID }),
      );
    }
    // 'Terminated' is reserved for future admin intervention and
    // intentionally leaves the leave request untouched here.
  },

  /**
   * SendBack -> the leave request becomes editable again.
   */
  applyRework: async (tx, instance, comments) => {
    await tx.run(
      UPDATE(LEAVE_REQUEST_ENTITY)
        .set({ status: "Draft", remarks: comments || "Sent back for corrections." })
        .where({ ID: instance.businessObjectId }),
    );
  },

  /**
   * Resubmit -> the request is back in the approval queue.
   */
  applyResubmit: async (tx, instance) => {
    await tx.run(
      UPDATE(LEAVE_REQUEST_ENTITY)
        .set({ status: "Pending", remarks: "Resubmitted after rework." })
        .where({ ID: instance.businessObjectId }),
    );
  },
});

// ------------------------------------------------------------
// Bound action: StartWorkflow on a single LeaveRequest
// ------------------------------------------------------------

module.exports = (srv) => {
  srv.on("StartWorkflow", srv.entities.LeaveRequests, async (req) => {
    const tx = cds.transaction(req);
    const leaveRequestId = req.params?.[0]?.ID || req.params?.[0];
    if (!leaveRequestId) {
      return req.error(400, "Leave request identifier missing.");
    }

    const leaveReq = await tx.run(
      SELECT.one.from(LEAVE_REQUEST_ENTITY).where({ ID: leaveRequestId }),
    );
    if (!leaveReq) {
      return req.error(404, "Leave request not found.");
    }

    // ---------------------------------------------------------
    // Ownership / role check (mirrors the Leave @restrict rules):
    // the requester may only start a workflow for THEIR OWN
    // request; HR and SystemAdmin may start for anyone.
    // ---------------------------------------------------------
    const me = req.user?.attr?.employeeId;
    const isOwner = me && me === leaveReq.employee_ID;
    const isHrOrAdmin = req.user
      ? (req.user.is("HRExecutive") || req.user.is("HRAdmin") || req.user.is("SystemAdmin"))
      : false;

    if (!isOwner && !isHrOrAdmin) {
      return req.error(
        403,
        "You can only start a workflow for your own leave request.",
      );
    }

    // Business-state guard: only Draft or Pending requests enter
    // a workflow; finalized requests are done.
    if (leaveReq.status !== "Draft" && leaveReq.status !== "Pending") {
      return req.error(
        400,
        `Leave request is '${leaveReq.status}'; only Draft or Pending requests can enter a workflow.`,
      );
    }

    // Delegate to the GENERIC engine with explicit context.
    return engine.startWorkflow(req, {
      businessObjectType: LEAVE_REQUEST_ENTITY,
      businessObjectId: leaveRequestId,
      requesterId: leaveReq.employee_ID,
      summary: req.data?.summary ||
        `Leave ${leaveReq.leaveNumber}: ${leaveReq.totalDays} day(s) from ${leaveReq.fromDate}`,
    });
  });
};
