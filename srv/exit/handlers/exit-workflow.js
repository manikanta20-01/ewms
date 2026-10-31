const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");
const { notify } = require("../../notification/handlers/notification-core");
const {
  CASE_DB,
  WORKFLOW_DECISION_FROM,
  recordEvent,
} = require("./exit-common");

// ============================================================
// SPRINT 21 - EXIT <-> GENERIC WORKFLOW BRIDGE
// ------------------------------------------------------------
// The Sprint 10 engine is the ONLY approval machinery in this
// project; approval state for exit cases is decided by:
//
//   * applyDecision  - a FINAL engine status (Approved / Rejected
//     / Cancelled) must land on the case. Approved: Submitted/
//     InReview -> Approved with approvedFinalWorkingDate falling
//     back to the proposed date. Rejected/Cancelled: land the
//     case (only while the case is still awaiting the decision).
//   * applyRework    - engine SendBack -> case returns to Draft
//     (the employee edits/proposes again).
//   * applyResubmit  - ResubmitWorkflow moves the case back to
//     Submitted so the engine restarts at step 1.
//
// Every callback is IDEMPOTENT by target-status check: a decision
// replayed twice leaves the case unchanged the second time.
// ============================================================

const EXIT_TYPE = "ewms.db.exit.ExitCase";

registerCallbacks(EXIT_TYPE, {
  applyDecision: async (tx, instance, decision, comments) => {
    const caseRow = await tx.run(
      SELECT.one.from(CASE_DB).where({ ID: instance.businessObjectId }),
    );
    if (!caseRow) return; // case deleted meanwhile (never by users)

    if (decision === "Approved") {
      // Only a case still waiting for the decision moves.
      if (!WORKFLOW_DECISION_FROM.includes(caseRow.status)) return;
      await tx.run(
        UPDATE(CASE_DB)
          .set({
            status: "Approved",
            approvedFinalWorkingDate:
              caseRow.approvedFinalWorkingDate || caseRow.proposedFinalWorkingDate || null,
          })
          .where({ ID: caseRow.ID }),
      );
      await recordEvent(tx, {
        caseId: caseRow.ID,
        eventType: "Approved",
        details: `Workflow approved. Approved final working date: ${caseRow.approvedFinalWorkingDate || caseRow.proposedFinalWorkingDate}.`,
        fromStatus: caseRow.status,
        toStatus: "Approved",
      });

      // The employee hears the decision at the transition (neutral
      // wording for employer-initiated cases - no reason disclosure
      // in message text).
      const neutral = caseRow.exitType === "EmployerInitiated";
      await notify(tx, {
        recipientId: caseRow.employee_ID,
        title: neutral
          ? `Exit case ${caseRow.exitNumber}: approval recorded`
          : `Your exit case ${caseRow.exitNumber} has been approved`,
        message: neutral
          ? "An approval was recorded on your exit case. Contact HR for next steps."
          : `Your exit case ${caseRow.exitNumber} is approved. Please prepare for clearance; final working date: ${caseRow.approvedFinalWorkingDate || caseRow.proposedFinalWorkingDate}.`,
        category: "EXIT",
        sourceModule: "EXIT",
        sourceEntity: "ewms.db.exit.ExitCase",
        sourceRecordId: caseRow.ID,
      });
    } else if (decision === "Rejected") {
      if (!WORKFLOW_DECISION_FROM.includes(caseRow.status)) return;
      await tx.run(
        UPDATE(CASE_DB).set({ status: "Rejected" }).where({ ID: caseRow.ID }),
      );
      await recordEvent(tx, {
        caseId: caseRow.ID,
        eventType: "Rejected",
        reason: comments,
        fromStatus: caseRow.status,
        toStatus: "Rejected",
      });
      // Decision notification for the employee as well; the
      // comments are approver input, not a reason guarantee.
      await notify(tx, {
        recipientId: caseRow.employee_ID,
        title: `Exit case ${caseRow.exitNumber} was not approved`,
        message: `Your exit case ${caseRow.exitNumber} was rejected at approval. Contact HR for details.`,
        category: "EXIT",
        sourceModule: "EXIT",
        sourceEntity: "ewms.db.exit.ExitCase",
        sourceRecordId: caseRow.ID,
      });
    } else if (decision === "Cancelled") {
      // Withdraw already moved the case - stay idempotent.
      if (!WORKFLOW_DECISION_FROM.includes(caseRow.status)) return;
      await tx.run(
        UPDATE(CASE_DB).set({ status: "Cancelled" }).where({ ID: caseRow.ID }),
      );
      await recordEvent(tx, {
        caseId: caseRow.ID,
        eventType: "Cancelled",
        reason: comments,
        fromStatus: caseRow.status,
        toStatus: "Cancelled",
      });
    }
    // 'Terminated' is the engine's cancelled-by-request final;
    // treat like Cancelled for completeness (withdraw path).
    else if (decision === "Terminated") {
      if (!WORKFLOW_DECISION_FROM.includes(caseRow.status)) return;
      await tx.run(
        UPDATE(CASE_DB).set({ status: "Cancelled" }).where({ ID: caseRow.ID }),
      );
      await recordEvent(tx, {
        caseId: caseRow.ID,
        eventType: "Cancelled",
        reason: comments,
        fromStatus: caseRow.status,
        toStatus: "Cancelled",
      });
    }
  },

  applyRework: async (tx, instance, comments) => {
    const caseRow = await tx.run(
      SELECT.one.from(CASE_DB).where({ ID: instance.businessObjectId }),
    );
    if (!caseRow) return;
    if (!WORKFLOW_DECISION_FROM.includes(caseRow.status)) return;
    await tx.run(
      UPDATE(CASE_DB).set({ status: "Draft" }).where({ ID: caseRow.ID }),
    );
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Reworked",
      reason: comments,
      fromStatus: caseRow.status,
      toStatus: "Draft",
    });
  },

  applyResubmit: async (tx, instance) => {
    // The requester pressed ResubmitWorkflow on the engine; sync
    // the case back to the submitted state (Draft -> Submitted).
    const caseRow = await tx.run(
      SELECT.one.from(CASE_DB).where({ ID: instance.businessObjectId }),
    );
    if (!caseRow) return;
    if (caseRow.status !== "Draft") return;
    await tx.run(
      UPDATE(CASE_DB).set({ status: "Submitted" }).where({ ID: caseRow.ID }),
    );
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Resubmitted",
      fromStatus: "Draft",
      toStatus: "Submitted",
    });
  },
});
