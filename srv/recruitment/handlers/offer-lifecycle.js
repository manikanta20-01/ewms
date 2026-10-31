const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");
const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");

// ============================================================
// SPRINT 12 - OFFER LETTER LIFECYCLE
// ------------------------------------------------------------
// Implements the offer state machine:
//
//   Draft -> PendingApproval -> (generic workflow OR direct HR
//          approval) -> Approved -> Sent -> Accepted / Rejected
//   Withdrawn and Expired as documented side exits.
//
// Design rules honored here:
//   * Approval reuses the Sprint 10 GENERIC workflow engine -
//     no second approval logic is built. Offers get their own
//     WorkflowDefinition (seeded in db/data) with the business
//     object type 'ewms.db.recruitment.Offer'.
//   * Compensation (offeredCTC) is masked on READ for users
//     without an HR/Finance/SystemAdmin role.
//   * Every state change writes an audit row and sends a
//     notification through the SHARED notification core.
// ============================================================

// NOTE (project convention): handler REGISTRATION uses the short
// SERVICE entity name; every QUERY/UPDATE inside uses the full DB
// entity name - the same pattern leave-request.js / leave-workflow.js
// follow (srv.on("CREATE", "LeaveRequests") + queries on
// "ewms.db.leave.LeaveRequest").
const OFFER_ENTITY = "Offers"; // service projection (registration only)
const OFFER_DB = "ewms.db.recruitment.Offer"; // DB table (queries)
const CANDIDATE_DB = "ewms.db.recruitment.Candidate";
const INSTANCE_ENTITY = "ewms.db.workflow.WorkflowInstance";
const OFFER_TYPE = "ewms.db.recruitment.Offer";

// ------------------------------------------------------------
// Allowed offer status transitions. Everything not listed here
// is rejected with 400 - impossible states can never be stored.
// ------------------------------------------------------------
const OFFER_TRANSITIONS = {
  Draft: ["PendingApproval", "Withdrawn"],
  PendingApproval: ["Approved", "Rejected", "Withdrawn", "Draft"],
  Approved: ["Sent", "Withdrawn"],
  Sent: ["Accepted", "Rejected", "Expired", "Withdrawn"],
  Accepted: [], // final
  Rejected: [], // final
  Expired: [], // final
  Withdrawn: [], // final
};

/** Validates one transition; returns an error response if invalid. */
function assertTransition(req, from, to) {
  const allowed = OFFER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Offer cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/**
 * Normalizes the bound-action / bound-CRUD key predicate.
 * req.params[0] may be a RAW UUID string (bound actions, CAP 8) -
 * passing that into .where() makes CQN parse the UUID as an
 * arithmetic expression and crash. It must be wrapped as { ID }.
 */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

/**
 * Does the caller hold a role allowed to see compensation?
 * DepartmentManager deliberately NOT included: they see the offer
 * (they are the reporting manager) but not the salary number.
 */
function maySeeCompensation(req) {
  return req.user.is("HRExecutive") || req.user.is("HRAdmin")
    || req.user.is("FinanceManager") || req.user.is("SystemAdmin");
}

/**
 * Creates the onboarding checklist-derived rows for a case.
 * Extracted so tests can assert the seeding behavior directly.
 */
async function createOnboardingCaseForAcceptedOffer(req, offer) {
  const tx = cds.transaction(req);      // IDEMPOTENCY GUARD: one accepted offer can only ever produce
      // ONE onboarding case. Re-running RecordAcceptance (or a retry
      // after a network error) must not create duplicates.
      let existing = await tx.run(
        SELECT.one.from("ewms.db.recruitment.OnboardingCase")
          .where({ offer_ID: offer.ID }),
      );
      if (existing) return existing;

  const caseId = cds.utils.uuid();
  await tx.run(
    INSERT.into("ewms.db.recruitment.OnboardingCase").entries({
      ID: caseId,
      onboardingNumber: await generateCode(
        req, "ewms.db.recruitment.OnboardingCase", "onboardingNumber", "ONB", 4,
      ),
      candidate_ID: offer.candidate_ID,
      offer_ID: offer.ID,
      plannedJoiningDate: offer.joiningDate || null,
      department_ID: offer.department_ID || null,
      designation_ID: offer.designation_ID || null,
      reportingManager_ID: offer.reportingManager_ID || null,
      status: "NotStarted",
      progress: 0,
    }),
  );

  // Seed tasks + document requirements from the ACTIVE standard
  // checklist. Same "template snapshot" idea the workflow engine
  // uses when copying definition steps into tasks.
  const checklist = await tx.run(
    SELECT.one.from("ewms.db.recruitment.OnboardingChecklist")
      .where({ isActive: true })
      .orderBy("ID"),
  );

  if (checklist) {
    const items = await tx.run(
      SELECT.from("ewms.db.recruitment.OnboardingChecklistItem")
        .where({ checklist_ID: checklist.ID })
        .orderBy("sequence"),
    );

    for (const item of items) {
      await tx.run(
        INSERT.into("ewms.db.recruitment.OnboardingTask").entries({
          ID: cds.utils.uuid(),
          onboardingCase_ID: caseId,
          taskCode: item.taskCode,
          title: item.title,
          description: item.description || null,
          assigneeRole: item.assigneeRole || null,
          sequence: item.sequence,
          mandatory: item.mandatory,
          status: "Pending",
        }),
      );
    }
  }

  // Standard document requirements (Sprint 17 adds real uploads).
  // If this case already has document requirements (replay), skip
  // creating them again.
  const existingDocs = await tx.run(
    SELECT.from("ewms.db.recruitment.OnboardingDocumentRequirement")
      .where({ onboardingCase_ID: caseId }),
  );
  if (!existingDocs || existingDocs.length === 0) {
    const standardDocs = [
      ["IDENTITY", "Identity proof"],
      ["ADDRESS", "Address proof"],
      ["EDUCATION", "Education certificate"],
      ["EXPERIENCE", "Previous employment certificate"],
      ["SIGNED_OFFER", "Signed offer letter"],
    ];
    for (const [type, title] of standardDocs) {
      await tx.run(
        INSERT.into("ewms.db.recruitment.OnboardingDocumentRequirement").entries({
          ID: cds.utils.uuid(),
          onboardingCase_ID: caseId,
          documentType: type,
          title,
          mandatory: true,
          status: "Required",
        }),
      );
    }
  }

  return tx.run(
    SELECT.one.from("ewms.db.recruitment.OnboardingCase").where({ ID: caseId }),
  );
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // CREATE: auto offer number, initial status, date validation
  // ----------------------------------------------------------
  srv.before("CREATE", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);

    req.data.offerNumber = await generateCode(
      req, OFFER_DB, "offerNumber", "OFF", 4,
    );
    if (!req.data.status) req.data.status = "Draft";

    // Candidate must exist (a dangling offer would break approval).
    if (!req.data.candidate_ID) {
      return req.error(400, "A candidate is required for an offer.");
    }
    const candidate = await tx.run(
      SELECT.one.from(CANDIDATE_DB).where({ ID: req.data.candidate_ID }),
    );
    if (!candidate) {
      return req.error(404, "Candidate not found.");
    }

    // Expiry must come after the offer date - otherwise the offer
    // would be born already-expired.
    if (
      req.data.offerDate && req.data.expiryDate
      && req.data.expiryDate < req.data.offerDate
    ) {
      return req.error(400, "expiryDate cannot be before offerDate.");
    }
  });

  // ----------------------------------------------------------
  // READ: mask compensation for roles without CTC visibility
  // ----------------------------------------------------------
  srv.after("READ", OFFER_ENTITY, async (data, req) => {
    if (!data || maySeeCompensation(req)) return;
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (row && "offeredCTC" in row) row.offeredCTC = null;
    }
  });

  // ----------------------------------------------------------
  // UPDATE guard: direct edits may never bypass the lifecycle
  // ----------------------------------------------------------
  srv.before("UPDATE", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    // keysOf wraps raw-UUID req.params[0] as { ID } - passing the
    // raw string into .where() makes CQN parse it as an expression.
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");

    if (req.data.status && req.data.status !== offer.status) {
      return req.error(
        400,
        "Offer status changes must use the lifecycle actions (SubmitForApproval, ApproveOffer, SendOffer, ...).",
      );
    }
    // Accepted offers are frozen completely.
    if (offer.status === "Accepted") {
      return req.error(400, "An accepted offer can no longer be modified.");
    }
  });

  // ----------------------------------------------------------
  // Lifecycle actions
  // ----------------------------------------------------------

  // Draft -> PendingApproval (+ start generic workflow when one is
  // configured for offers). Otherwise the direct HR fallback applies.
  srv.on("SubmitForApproval", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "PendingApproval");

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "PendingApproval" })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "PendingApproval" });

    // Try the generic workflow engine. If no ACTIVE definition
    // exists for offers this stays in PendingApproval and HR can
    // use the direct ApproveOffer fallback - recorded in comments.
    const engine = require("../../workflow/handlers/workflow-engine");
    let result;
    try {
      result = await engine.startWorkflow(req, {
        businessObjectType: OFFER_TYPE,
        businessObjectId: offer.ID,
        requesterId: req.user?.attr?.employeeId,
        summary: `Offer ${offer.offerNumber} approval`,
      });
    } catch (e) {
      result = null;
    }

    if (result === null || result === undefined) {
      return "Offer submitted. No active workflow definition - use direct approval.";
    }
    return result;
  });

  // Direct approval fallback (HRAdmin/SystemAdmin only).
  // Blocked while a workflow instance is running - one authority at
  // a time. Non-authorized users get 403 (recruitment-security).
  srv.on("ApproveOffer", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Approved");

    if (!req.user.is("HRAdmin") && !req.user.is("SystemAdmin")) {
      return req.error(
        403,
        "Only HR admins may directly approve an offer. Apprival via workflow tasks is open to the configured approver.",
      );
    }

    const running = await tx.run(
      SELECT.one.from(INSTANCE_ENTITY).where({
        businessObjectType: OFFER_TYPE,
        businessObjectId: offer.ID,
        status: { in: ["Running", "Rework"] },
      }),
    );
    if (running) {
      return req.error(
        409,
        "A workflow instance is still running for this offer. Approve through the workflow tasks.",
      );
    }

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Approved", notes: req.data.comments || offer.notes })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Approved" });

    // Notify the HR owner that the offer is ready to send.
    await notify(cds.transaction(req), {
      recipientId: req.user?.attr?.employeeId,
      title: `Offer ${offer.offerNumber} approved`,
      message: `Offer ${offer.offerNumber} was approved and is ready to be sent to the candidate.`,
      category: "RECRUITMENT",
      priority: "Medium",
      sourceModule: "RECRUITMENT",
      sourceEntity: "Offer",
      sourceRecordId: offer.ID,
    });

    return "Offer approved.";
  });

  // Direct rejection fallback (HRAdmin/SystemAdmin only).
  srv.on("RejectOffer", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Rejected");

    if (!req.user.is("HRAdmin") && !req.user.is("SystemAdmin")) {
      return req.error(
        403,
        "Only HR admins may directly reject an offer.",
      );
    }

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Rejected", notes: req.data.comments || offer.notes })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Rejected" });
    return "Offer rejected.";
  });

  // Approved -> Sent to the candidate.
  srv.on("SendOffer", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Sent");

    if (!offer.expiryDate) {
      return req.error(400, "An expiryDate is required before sending an offer.");
    }

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Sent", sentOn: new Date().toISOString() })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Sent" });

    await notify(cds.transaction(req), {
      recipientId: offer.reportingManager_ID || req.user?.attr?.employeeId,
      title: `Offer ${offer.offerNumber} sent`,
      message: `Offer ${offer.offerNumber} has been sent to the candidate and awaits their response.`,
      category: "RECRUITMENT",
      priority: "Low",
      sourceModule: "RECRUITMENT",
      sourceEntity: "Offer",
      sourceRecordId: offer.ID,
    });

    return "Offer sent to candidate.";
  });

  // Candidate ACCEPTED (recorded by HR - candidates have no user).
  // Locks the offer and auto-creates the onboarding case.
  srv.on("RecordAcceptance", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Accepted");

    // An expired offer can never be accepted.
    if (offer.expiryDate && offer.expiryDate < new Date().toISOString().slice(0, 10)) {
      return req.error(400, "This offer has expired and cannot be accepted.");
    }

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Accepted", acceptedOn: new Date().toISOString() })
      .where({ ID: offer.ID }));

    // Candidate moves to 'Hired' only AFTER onboarding conversion;
    // here they are committed to the recruitment pipeline.
    await tx.run(UPDATE(CANDIDATE_DB)
      .set({ status: "Selected" })
      .where({ ID: offer.candidate_ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Accepted" });

    const onboardingCase = await createOnboardingCaseForAcceptedOffer(req, offer);

    await notify(cds.transaction(req), {
      recipientId: offer.reportingManager_ID || req.user?.attr?.employeeId,
      title: `Offer ${offer.offerNumber} accepted`,
      message: onboardingCase
        ? `Candidate accepted offer ${offer.offerNumber}. Onboarding case ${onboardingCase.onboardingNumber} was created.`
        : `Candidate accepted offer ${offer.offerNumber}.`,
      category: "RECRUITMENT",
      priority: "High",
      sourceModule: "RECRUITMENT",
      sourceEntity: "OnboardingCase",
      sourceRecordId: onboardingCase?.ID || offer.ID,
    });

    return onboardingCase
      ? `Offer accepted. Onboarding case ${onboardingCase.onboardingNumber} created.`
      : "Offer accepted.";
  });

  // Candidate DECLINED the offer.
  srv.on("RecordRejection", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Rejected");

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Rejected", notes: req.data.comments || offer.notes })
      .where({ ID: offer.ID }));

    await tx.run(UPDATE(CANDIDATE_DB)
      .set({ status: "Rejected" })
      .where({ ID: offer.candidate_ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Rejected" });
    return "Candidate rejection recorded.";
  });

  // HR withdraws a not-yet-accepted offer.
  srv.on("WithdrawOffer", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Withdrawn");

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Withdrawn", notes: req.data.comments || offer.notes })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Withdrawn" });
    return "Offer withdrawn.";
  });

  // Housekeeping: mark an unanswered offer as expired.
  srv.on("ExpireOffer", OFFER_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const offer = await tx.run(SELECT.one.from(OFFER_DB).where(keysOf(req)));
    if (!offer) return req.error(404, "Offer not found.");
    assertTransition(req, offer.status, "Expired");

    await tx.run(UPDATE(OFFER_DB)
      .set({ status: "Expired" })
      .where({ ID: offer.ID }));

    await persistAudit(req, "UPDATE", "Offers", offer, { status: "Expired" });
    return "Offer marked as expired.";
  });

  // ----------------------------------------------------------
  // WORKFLOW CALLBACKS: sync the offer when the generic workflow
  // for businessObjectType 'ewms.db.recruitment.Offer' finishes.
  // ----------------------------------------------------------
  registerCallbacks(OFFER_TYPE, {
    applyDecision: async (tx, instance, decision, comments) => {
      if (decision === "Approved") {
        await tx.run(UPDATE(OFFER_DB)
          .set({ status: "Approved" })
          .where({ ID: instance.businessObjectId }));
      } else if (decision === "Rejected") {
        await tx.run(UPDATE(OFFER_DB)
          .set({ status: "Rejected", notes: comments || null })
          .where({ ID: instance.businessObjectId }));
      } else if (decision === "Cancelled") {
        // Requester withdrew while the workflow was running.
        await tx.run(UPDATE(OFFER_DB)
          .set({ status: "Withdrawn", notes: comments || null })
          .where({ ID: instance.businessObjectId }));
      }
      // 'Terminated' deliberately leaves the offer untouched.
    },

    applyRework: async (tx, instance, comments) => {
      await tx.run(UPDATE(OFFER_DB)
        .set({ status: "Draft", notes: comments || null })
        .where({ ID: instance.businessObjectId }));
    },

    applyResubmit: async (tx, instance) => {
      await tx.run(UPDATE(OFFER_DB)
        .set({ status: "PendingApproval" })
        .where({ ID: instance.businessObjectId }));
    },

    getTitle: async (tx, instance) => {
      const offer = await tx.run(
        SELECT.one.from(OFFER_DB).where({ ID: instance.businessObjectId }),
      );
      return offer ? `Offer ${offer.offerNumber}` : instance.businessObjectId;
    },
  });
};
