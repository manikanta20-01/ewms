const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { persistAudit } = require("../../common/utils/audit");
const { hasGroup } = require("../../common/auth/authorization");
const { notify } = require("../../notification/handlers/notification-core");
const engine = require("../../workflow/handlers/workflow-engine");
const {
  CASE_DB,
  SUBMIT_FROM,
  WITHDRAW_FROM,
  assertTransition,
  keysOf,
  actorId,
  isHR,
  hasOpenCase,
  recordEvent,
  maskReasonsForNonHR,
} = require("./exit-common");

// ============================================================
// SPRINT 21 - EXIT LIFECYCLE (creation -> workflow gates)
// ------------------------------------------------------------
// Registration uses the SHORT service entity name ("ExitCases");
// all queries use the full DB entity "ewms.db.exit.ExitCase" -
// the same convention the leave/recruitment/asset modules use.
//
// Golden rules enforced here:
//   * requester/employee stamping can never be spoofed by
//     payload fields (plain employees create only their own
//     cases; EmployerInitiated cases are HR-created),
//   * duplicate-safe creation via clientRequestId + a ONE-open-
//     case-per-employee rule,
//   * the notice-period policy is CONFIGURATION (ExitNoticePolicy
//     rows): a missing row surfaces 'NotConfigured' instead of
//     inventing a legal default; a short date is REFUSED until
//     an authorized HR waiver is recorded,
//   * submission starts the Sprint 10 generic workflow (Manager
//     -> HR); nothing here implements its own approval logic.
// ============================================================

const POLICY_DB = "ewms.db.exit.ExitNoticePolicy";
const NOTIF_EXIT = "EXIT"; // shared NotificationCategory value

/** today as an ISO date string (the project's date convention). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // CREATE: stamp + validate + duplicate-safe
  // ----------------------------------------------------------
  srv.before("CREATE", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const data = req.data;

    // ---- duplicate-safe retries (same pattern as Sprint 19/20):
    // The SAME clientRequestId never creates a second case; the
    // dedupe row is reported by number so the retry client can
    // reuse its original target safely.
    if (data.clientRequestId) {
      const requesterId = data.employee_ID || actorId(req);
      const dup = await tx.run(
        SELECT.one.from(CASE_DB).where({
          clientRequestId: data.clientRequestId,
        }),
      );
      if (dup) {
        return req.reject(
          409,
          `A case already exists for clientRequestId '${data.clientRequestId}': exit ${dup.exitNumber}. A retried request never creates a second case.`,
        );
      }
    }

    const me = actorId(req);
    const isExitType = (t) => data.exitType === t;

    // ---- WHO initiates what (B3 permissions):
    // EmployerInitiated is employer-sensitive: HR trio only.
    if (isExitType("EmployerInitiated") && !isHR(req)) {
      return req.reject(
        403,
        "Employer-initiated exits may only be created by authorized HR users.",
      );
    }

    if (!isHR(req)) {
      // Plain employees raise cases ONLY about themselves - no
      // spoofed employee_ID can survive this guard.
      if (!me) {
        return req.reject(403, "Your user is not linked to an employee record.");
      }
      if (data.employee_ID && data.employee_ID !== me) {
        return req.reject(403, "You may only create exit cases for yourself.");
      }
      data.employee_ID = me;
      if (!data.initiator_ID) data.initiator_ID = me;
    } else if (!data.employee_ID) {
      // HR must nominate the departing employee explicitly.
      return req.reject(400, "HR must specify the departing employee (employee_ID).");
    } else {
      data.initiator_ID = data.initiator_ID || me;
    }

    // ---- reason fields are mandatory (private but required).
    // Deliberate order: field validation runs FIRST, so a client
    // re-posting a broken payload sees its real 400, not a
    // duplicate-case 409 from a previous valid submission.
    if (!data.reasonCategory || !data.reasonText) {
      return req.reject(400, "reasonCategory and reasonText are required for an exit case.");
    }

    // ---- proposed final working date must be in the future
    // (when given; Resignation cases are expected to give one).
    if (data.proposedFinalWorkingDate) {
      if (data.proposedFinalWorkingDate <= today()) {
        return req.reject(400, "proposedFinalWorkingDate must be in the future.");
      }
    } else if (isExitType("Resignation")) {
      return req.reject(400, "A resignation case requires proposedFinalWorkingDate.");
    }

    // ---- one open case per employee (duplicate prevention):
    if (await hasOpenCase(tx, data.employee_ID)) {
      return req.reject(
        409,
        "This employee already has an exit case in an open status. Duplicate exit cases are refused.",
      );
    }

    // ---- business code generated BEFORE the insert (the column is
    // NOT NULL; same order the helpdesk uses).
    if (!data.exitNumber) {
      data.exitNumber = await generateCode(req, CASE_DB, "exitNumber", "EXT", 4);
    }
  });

  srv.after("CREATE", "ExitCases", async (data, req) => {
    const tx = cds.transaction(req);
    await recordEvent(tx, {
      caseId: data.ID,
      eventType: "Created",
      actor: actorId(req),
      details: `Exit case created (${data.exitType}).`,
      toStatus: data.status,
    });
    await persistAudit(req, "Created", "ewms.db.exit.ExitCase", null,
      { exitNumber: data.exitNumber, status: data.status });
  });

  // ----------------------------------------------------------
  // SUBMIT: Draft -> Submitted + notice validation + workflow
  // ----------------------------------------------------------
  srv.on("Submit", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (!SUBMIT_FROM.includes(caseRow.status)) {
      return req.error(400, `An exit case can be submitted only from Draft (status is '${caseRow.status}').`);
    }

    // Requester (the departing employee) and HR may submit.
    if (!isHR(req) && actorId(req) !== caseRow.employee_ID) {
      return req.error(403, "Only the departing employee (or HR) can submit this case.");
    }

    const date = caseRow.proposedFinalWorkingDate || caseRow.approvedFinalWorkingDate;
    if (!date) {
      return req.error(400, "A final working date is required before submission.");
    }
    if (date <= today()) {
      return req.error(400, "The final working date must be in the future.");
    }

    // ---- notice period: CONFIGURATION ONLY (B4) --------------
    const policy = await tx.run(
      SELECT.one.from(POLICY_DB).where({ exitType: caseRow.exitType, active: true }),
    );

    let noticeStatus = "NotConfigured";
    let noticeDays = null;

    if (policy && policy.noticePeriodDays != null) {
      noticeDays = policy.noticePeriodDays;
      const minDate = new Date();
      minDate.setDate(minDate.getDate() + noticeDays);
      const requiredFrom = minDate.toISOString().slice(0, 10);
      const isShort = date < requiredFrom;

      // Refuse with the CONFIGURED rule quoted - never a
      // hardcoded number. HR must waive explicitly first.
      if (isShort && !caseRow.noticeWaivedOn) {
        return req.error(
          400,
          `The configured notice period for '${caseRow.exitType}' is ${noticeDays} day(s): the final working date must not be earlier than ${requiredFrom}. Ask HR to record an authorized notice-period waiver if this earlier date is approved.`,
        );
      }

      noticeStatus = isShort ? "Waived" : "Met";
      // noticeDays = 0 means the exit type needs NO notice: always Met.
      if (noticeDays === 0) noticeStatus = "Met";
    } else {
      // Missing configuration is a visible gap, not a pass:
      // the case records 'NotConfigured' for HR to decide.
      noticeStatus = "NotConfigured";
    }

    const before = caseRow.status;
    await tx.run(
      UPDATE(CASE_DB)
        .set({
          status: "Submitted",
          submittedOn: new Date().toISOString(),
          noticePeriodDays: noticeDays,
          noticePeriodStatus: noticeStatus,
        })
        .where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Submitted",
      actor: actorId(req),
      details: `Notice period: ${noticeStatus}${noticeDays != null ? ` (${noticeDays} day(s), configured)` : " (no configured policy)"}.`,
      fromStatus: before,
      toStatus: "Submitted",
    });
    await persistAudit(req, "Submitted", "ewms.db.exit.ExitCase", { status: before }, { status: "Submitted" });

    // ---- start the GENERIC workflow (Sprint 10) --------------
    // A fresh instance on every submission; a REJECTED older
    // instance is final, so the engine allows this. A still-
    // Running instance is impossible here (this case was Draft).
    const startResult = await engine.startWorkflow(req, {
      businessObjectType: "ewms.db.exit.ExitCase",
      businessObjectId: caseRow.ID,
      requesterId: caseRow.employee_ID,
      summary: `Exit case ${caseRow.exitNumber} submitted for approval.`,
    });
    // Persist the workflow linkage for late lookups.
    const instance = await tx.run(
      SELECT.one.from("ewms.db.workflow.WorkflowInstance").where({
        businessObjectType: "ewms.db.exit.ExitCase",
        businessObjectId: caseRow.ID,
        status: "Running",
      }),
    );
    if (instance) {
      await tx.run(
        UPDATE(CASE_DB).set({ workflowInstanceId: instance.ID }).where({ ID: caseRow.ID }),
      );
    }

    // Notify the department's active HR representatives.
    const recipients = await departmentHrRecipientsFromDb(tx);
    for (const recipientId of recipients) {
      if (recipientId !== caseRow.employee_ID) {
        const isEmployer = caseRow.exitType === "EmployerInitiated";
        await notify(tx, {
          recipientId,
          title: isEmployer
            ? `Employer-initiated exit case ${caseRow.exitNumber} submitted` // neutral title, no reason
            : `Exit case ${caseRow.exitNumber} submitted`,
          message: isEmployer
            ? "An employer-initiated exit case was submitted and is waiting for approval."
            : `Exit case ${caseRow.exitNumber} (${caseRow.exitType}) was submitted and is waiting for approval.`,
          category: NOTIF_EXIT,
          sourceModule: "EXIT",
          sourceEntity: "ewms.db.exit.ExitCase",
          sourceRecordId: caseRow.ID,
          actionLink: `/exit/ExitCases(${caseRow.ID})`,
        });
      }
    }

    return startResult || `Exit case ${caseRow.exitNumber} submitted for approval.`;
  });

  // ----------------------------------------------------------
  // START REVIEW: Submitted -> InReview (HR)
  // ----------------------------------------------------------
  srv.on("StartReview", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    assertTransition(req, caseRow.status, "InReview");

    const me = actorId(req);
    if (!me) return req.error(403, "Your user is not linked to an employee record.");

    await tx.run(
      UPDATE(CASE_DB).set({ status: "InReview", hrOwner_ID: me }).where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "ReviewStarted",
      actor: me,
      fromStatus: caseRow.status,
      toStatus: "InReview",
    });
    await persistAudit(req, "ReviewStarted", "ewms.db.exit.ExitCase", { status: caseRow.status }, { status: "InReview", hrOwner: me });

    return `Exit case ${caseRow.exitNumber} moved to InReview and assigned to the acting HR owner.`;
  });

  // ----------------------------------------------------------
  // WAIVE NOTICE: authorized HR waiver BEFORE a short date is
  // submitted (explicit, attributed, audited - never silent).
  // ----------------------------------------------------------
  srv.on("WaiveNotice", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (!["Draft", "Submitted", "InReview"].includes(caseRow.status)) {
      return req.error(400, "Notice can only be waived before the case reaches Approved.");
    }
    const reason = req.data?.reason;
    if (!reason || !reason.trim()) return req.error(400, "A waiver requires a mandatory reason.");

    const me = actorId(req);
    await tx.run(
      UPDATE(CASE_DB)
        .set({ noticeWaivedBy_ID: me, noticeWaivedOn: new Date().toISOString(), noticeWaiverReason: reason })
        .where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "NoticeWaived",
      actor: me,
      reason,
      details: `The configured notice period (${caseRow.noticePeriodDays ?? "not configured"} day(s)) was waived by HR.`,
    });
    await persistAudit(req, "NoticeWaived", "ewms.db.exit.ExitCase", null, { reason });

    return `Notice-period waiver recorded with reason (case ${caseRow.exitNumber}).`;
  });

  // ----------------------------------------------------------
  // CHANGE APPROVED DATE: HR, pre-approval, reason mandatory.
  // History keeps every change; nothing silently overwritten.
  // ----------------------------------------------------------
  srv.on("ChangeApprovedDate", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (!["Submitted", "InReview"].includes(caseRow.status)) {
      return req.error(400, "The approved final working date can only be changed while the case is Submitted or InReview.");
    }
    const { finalWorkingDate, reason } = req.data || {};
    if (!finalWorkingDate) return req.error(400, "finalWorkingDate is required.");
    if (!reason || !reason.trim()) {
      return req.error(400, "A mandatory reason is required for a final-working-date change.");
    }
    if (finalWorkingDate <= today()) {
      return req.error(400, "The final working date must be in the future.");
    }

    const me = actorId(req);
    await tx.run(
      UPDATE(CASE_DB).set({ approvedFinalWorkingDate: finalWorkingDate }).where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "FinalDateChanged",
      actor: me,
      reason,
      details: `Approved final working date set to ${finalWorkingDate} (proposed was ${caseRow.proposedFinalWorkingDate ?? "n/a"}).`,
    });
    await persistAudit(req, "FinalDateChanged", "ewms.db.exit.ExitCase",
      { approvedFinalWorkingDate: caseRow.approvedFinalWorkingDate },
      { approvedFinalWorkingDate: finalWorkingDate });

    return `Final working date of case ${caseRow.exitNumber} changed to ${finalWorkingDate} (reason recorded).`;
  });

  // ----------------------------------------------------------
  // WITHDRAW: requester or HR, from Draft/Submitted/InReview -
  // also cancels the running workflow instance (R2-safe; the
  // engine refuses finalized instances itself).
  // ----------------------------------------------------------
  srv.on("Withdraw", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (!WITHDRAW_FROM.includes(caseRow.status)) {
      return req.error(400, `A case can be withdrawn only from ${WITHDRAW_FROM.join("/")} (status is '${caseRow.status}').`);
    }

    const me = actorId(req);
    const isOwner = me && me === caseRow.employee_ID;
    if (!isOwner && !isHR(req)) {
      return req.error(403, "Only the departing employee (or HR) can withdraw this case.");
    }

    const before = caseRow.status;
    await tx.run(UPDATE(CASE_DB).set({ status: "Withdrawn" }).where({ ID: caseRow.ID }));
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Withdrawn",
      actor: me,
      reason: req.data?.reason,
      fromStatus: before,
      toStatus: "Withdrawn",
    });
    await persistAudit(req, "Withdrawn", "ewms.db.exit.ExitCase", { status: before }, { status: "Withdrawn" });

    // Cancel the approval journey as well (workflow may be
    // Running or Rework). The case was already moved to Withdrawn,
    // so the engine's 'Cancelled' decision callback stays a no-op
    // (identity, never a second status flip).
    if (caseRow.workflowInstanceId) {
      const instance = await tx.run(
        SELECT.one.from("ewms.db.workflow.WorkflowInstance").where({
          ID: caseRow.workflowInstanceId,
        }),
      );
      if (instance && ["Running", "Rework"].includes(instance.status)) {
        // Reuse the ENGINE's own finalize path (exported by the
        // Sprint 10 core) so history rows close dangling tasks
        // exactly like a workflow-service Cancel would. No second
        // cancellation implementation is built here.
        await engine.finalizeInstance(req, tx, instance, "Cancelled", req.data?.reason || "Exit case withdrawn.", null);
      }
    }

    return `Exit case ${caseRow.exitNumber} withdrawn.`;
  });

  // ----------------------------------------------------------
  // RECONSIDER: HR reopens a REJECTED case back to Draft with a
  // mandatory reason. The next Submit starts a FRESH workflow -
  // the rejected instance itself stays final and immutable.
  // ----------------------------------------------------------
  srv.on("Reconsider", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    assertTransition(req, caseRow.status, "Draft");

    // Whitespace-only payloads count as absent (audit quality).
    if (!req.data?.reason?.trim()) return req.error(400, "A reason is mandatory to reconsider a rejected case.");

    const me = actorId(req);
    await tx.run(
      UPDATE(CASE_DB)
        .set({
          status: "Draft",
          approvedFinalWorkingDate: null,
          noticePeriodStatus: caseRow.noticePeriodDays != null ? "Met" : "NotConfigured",
        })
        .where({ ID: caseRow.ID }),
    );
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Reconsidered",
      actor: me,
      reason: req.data.reason,
      fromStatus: "Rejected",
      toStatus: "Draft",
    });
    await persistAudit(req, "Reconsidered", "ewms.db.exit.ExitCase", { status: "Rejected" }, { status: "Draft" });

    return `Rejected case ${caseRow.exitNumber} moved back to Draft for resubmission (reason recorded).`;
  });

  // ----------------------------------------------------------
  // CORRECT: the ONLY change path for COMPLETED cases. Narrow
  // (separationDate), HRAdmin/SystemAdmin only, reason mandatory,
  // always an ExitEvent + audit row. Direct PATCH is impossible
  // (no UPDATE grant), so this is a controlled, auditable process.
  // ----------------------------------------------------------
  srv.on("Correct", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (caseRow.status !== "Completed") {
      return req.error(400, "Correct applies only to Completed cases; open cases use their normal actions.");
    }

    const { separationDate, reason } = req.data || {};
    // Whitespace-only reasons count as absent (audit quality).
    if (!req.data?.reason || !req.data.reason.trim()) {
      return req.error(400, "A mandatory reason is required for a correction.");
    }

    const set = {};
    const details = [];
    if (separationDate) {
      set.separationDate = separationDate;
      details.push(`separationDate ${caseRow.separationDate} -> ${separationDate}`);
    }

    if (Object.keys(set).length > 0) {
      await tx.run(UPDATE(CASE_DB).set(set).where({ ID: caseRow.ID }));
    }
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Corrected",
      actor: actorId(req),
      reason,
      details: details.join("; ") || "Correction recorded (no field change).",
    });
    await persistAudit(req, "Corrected", "ewms.db.exit.ExitCase",
      { separationDate: caseRow.separationDate },
      set);

    return `Correction recorded on completed case ${caseRow.exitNumber} (audited).`;
  });

  // ----------------------------------------------------------
  // READ-time privacy: employer-initiated reasons are masked for
  // every non-HR reader (server-side, not a UI hide). CAP hands
  // lists as arrays and single reads as one object - normalize.
  // ----------------------------------------------------------
  srv.after("READ", "ExitCases", async (rows, req) => {
    if (!rows) return;
    const list = Array.isArray(rows) ? rows : [rows];
    await maskReasonsForNonHR(list, req);
    return rows;
  });
};

// ------------------------------------------------------------
// DepartmentHR recipients helper (DB-based, no duplication of
// the helpdesk routing - same table, same rule).
// ------------------------------------------------------------
async function departmentHrRecipientsFromDb(tx) {
  const rows = await tx.run(
    SELECT.from("ewms.db.organization.DepartmentHR").where({ isActive: true }),
  );
  return rows.map((r) => r.employee_ID).filter(Boolean);
}
