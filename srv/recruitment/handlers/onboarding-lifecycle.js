const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");

// Small local require shim so the file loads even if the frozen
// notification core is temporarily absent (repair safety): a
// notification failure must never break onboarding business logic.
let notify = () => {};
try {
  const core = require("../../notification/handlers/notification-core");
  if (core && typeof core.notify === "function") notify = core.notify;
} catch {
  // Notification core unavailable - continue without notifications.
}

// ============================================================
// SPRINT 12 - ONBOARDING LIFECYCLE
// ------------------------------------------------------------
// Handles:
//   * OnboardingCases: Start / Hold / Resume / Complete / Cancel
//   * OnboardingTasks: Start / Complete / Skip / Block / Reopen
//   * OnboardingDocumentRequirements: Submit / Verify / Reject /
//     Waive
//
// Key rules:
//   * Onboarding completion is BLOCKED while mandatory tasks or
//     mandatory documents are still open. Waived and Rejected
//     documents do NOT block: Waived is an explicit HR exemption,
//     and a Rejected document blocks only through its mandatory
//     resubmission state (Required -> Submitted ...). To keep V1
//     simple and predictable the doc guard accepts only
//     Verified / Waived for mandatory documents.
//   * Every task change recalculates the case progress (stored on
//     the case, so list pages never need to load all tasks).
//   * Idempotency: the ConvertToEmployee handler (see
//     employee-conversion.js) is the only place that creates
//     employees; this file never touches the Employee entity.
// ============================================================

// Handler REGISTRATION uses the short SERVICE entity names;
// every QUERY/UPDATE inside uses the full DB entity names -
// matching the leave module convention (leave-request.js +
// leave-workflow.js).
const CASE_ENTITY = "OnboardingCases";
const TASK_ENTITY = "OnboardingTasks";
const DOC_ENTITY = "OnboardingDocumentRequirements";
const CASE_DB = "ewms.db.recruitment.OnboardingCase";
const TASK_DB = "ewms.db.recruitment.OnboardingTask";
const DOC_DB = "ewms.db.recruitment.OnboardingDocumentRequirement";

// ------------------------------------------------------------
// Allowed transitions. Anything not listed is rejected with 400.
// ------------------------------------------------------------
const CASE_TRANSITIONS = {
  NotStarted: ["InProgress", "Cancelled"],
  InProgress: ["OnHold", "Completed", "Cancelled"],
  OnHold: ["InProgress", "Cancelled"],
  Completed: [], // final
  Cancelled: [], // final
};

const TASK_TRANSITIONS = {
  Pending: ["InProgress", "Skipped", "Blocked"],
  InProgress: ["Completed", "Blocked", "Pending"],
  Completed: [], // reopening goes through ReopenTask explicitly
  Skipped: ["Pending"],
  Blocked: ["Pending", "InProgress"],
};

const DOC_TRANSITIONS = {
  Required: ["Submitted", "Waived"],
  Submitted: ["Verified", "Rejected", "Waived"],
  Verified: [],
  Rejected: ["Submitted"],
  Waived: ["Required"],
};

/** Validates one transition; returns an error response if invalid. */
function assertTransition(req, from, to, allowedMap) {
  const allowed = allowedMap[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/**
 * Normalizes the bound-action / bound-CRUD key predicate.
 * req.params[0] may be a RAW UUID string (bound actions, CAP 8) -
 * it must be wrapped as { ID } before .where(), otherwise CQN
 * parses the UUID as an arithmetic expression and crashes.
 */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

/** Recalculates and stores case progress from its tasks. */
async function recalculateProgress(tx, caseId) {
  const tasks = await tx.run(
    SELECT.from(TASK_DB).where({ onboardingCase_ID: caseId }),
  );
  const total = tasks.length;
  const done = tasks.filter(
    (t) => t.status === "Completed" || t.status === "Skipped",
  ).length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  await tx.run(UPDATE(CASE_DB).set({ progress }).where({ ID: caseId }));
  return progress;
}

/** Loads an onboarding case or returns a 404 error response. */
async function loadCase(req, tx, keys) {
  const row = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req) || keys));
  if (!row) {
    req.error(404, "Onboarding case not found.");
    return null;
  }
  return row;
}

/** Loads a task + its parent case, or null after emitting 404. */
async function loadTask(req, tx) {
  const keys = req.params?.[0] || { ID: req.data.ID };
  const task = await tx.run(SELECT.one.from(TASK_DB).where(keysOf(req) || keys));
  if (!task) {
    req.error(404, "Onboarding task not found.");
    return null;
  }
  const onboardingCase = await tx.run(
    SELECT.one.from(CASE_DB).where({ ID: task.onboardingCase_ID }),
  );
  return { task, onboardingCase };
}

/** Loads a document requirement row, or null after emitting 404. */
async function loadDoc(req, tx) {
  const keys = req.params?.[0] || { ID: req.data.ID };
  const doc = await tx.run(SELECT.one.from(DOC_DB).where(keysOf(req) || keys));
  if (!doc) {
    req.error(404, "Onboarding document requirement not found.");
    return null;
  }
  return doc;
}

/** Guard used by task/doc actions: case must be InProgress. */
async function assertCaseInProgress(req, tx, caseId) {
  const onboardingCase = await tx.run(
    SELECT.one.from(CASE_DB).where({ ID: caseId }),
  );
  if (!onboardingCase) {
    req.error(404, "Onboarding case not found.");
    return null;
  }
  if (onboardingCase.status !== "InProgress") {
    req.error(
      400,
      `Onboarding case is '${onboardingCase.status}'; tasks and documents can only be worked on while the case is InProgress.`,
    );
    return null;
  }
  return onboardingCase;
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // CASE: direct UPDATE may never bypass the lifecycle
  // ----------------------------------------------------------
  srv.before("UPDATE", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const keys = req.params?.[0] || { ID: req.data.ID };
    const onboardingCase = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req) || keys));
    if (!onboardingCase) return req.error(404, "Onboarding case not found.");

    if (req.data.status && req.data.status !== onboardingCase.status) {
      return req.error(
        400,
        "Onboarding status changes must use the lifecycle actions (StartOnboarding, HoldOnboarding, CompleteOnboarding, ...).",
      );
    }
    if (onboardingCase.status === "Completed") {
      return req.error(400, "A completed onboarding case can no longer be modified.");
    }
  });

  // ----------------------------------------------------------
  // CASE actions
  // ----------------------------------------------------------
  srv.on("StartOnboarding", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await loadCase(req, tx, keysOf(req));
    if (!onboardingCase) return;
    assertTransition(req, onboardingCase.status, "InProgress", CASE_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "InProgress", startedAt: new Date().toISOString() })
        .where({ ID: onboardingCase.ID }),
    );


    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, { status: "InProgress" });
    await notify(tx, {
      recipientId: onboardingCase.reportingManager_ID,
      title: `Onboarding ${onboardingCase.onboardingNumber} started`,
      message: `Onboarding for candidate ${onboardingCase.candidate_ID} has started.`,
      category: "RECRUITMENT",
      priority: "Medium",
      sourceModule: "RECRUITMENT",
      sourceEntity: "OnboardingCase",
      sourceRecordId: onboardingCase.ID,
    });
  });

  srv.on("HoldOnboarding", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await loadCase(req, tx, keysOf(req));
    if (!onboardingCase) return;
    assertTransition(req, onboardingCase.status, "OnHold", CASE_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "OnHold", notes: req.data.comments || onboardingCase.notes })
        .where({ ID: onboardingCase.ID }),
    );
    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, { status: "OnHold" });
    return "Onboarding case put on hold.";
  });

  srv.on("ResumeOnboarding", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await loadCase(req, tx, keysOf(req));
    if (!onboardingCase) return;
    assertTransition(req, onboardingCase.status, "InProgress", CASE_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(CASE_DB).set({ status: "InProgress" }).where({ ID: onboardingCase.ID }),
    );
    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, { status: "InProgress" });
    return "Onboarding case resumed.";
  });

  srv.on("CompleteOnboarding", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await loadCase(req, tx, keysOf(req));
    if (!onboardingCase) return;
    assertTransition(req, onboardingCase.status, "Completed", CASE_TRANSITIONS);
    if (req.errors?.length) return;

    // MANDATORY GUARD: no completion while mandatory tasks are open.
    // Skipped mandatory tasks are accepted as done for completion.
    const openTasks = await tx.run(
      SELECT.from(TASK_DB).where({
        onboardingCase_ID: onboardingCase.ID,
        mandatory: true,
        status: { in: ["Pending", "InProgress", "Blocked"] },
      }),
    );
    if (openTasks.length > 0) {
      return req.error(
        400,
        `Onboarding cannot be completed: ${openTasks.length} mandatory task(s) still open (${openTasks
          .map((t) => t.title)
          .join(", ")}).`,
      );
    }

    // MANDATORY GUARD (documents): only Verified or Waived counts.
    const openDocs = await tx.run(
      SELECT.from(DOC_DB).where({
        onboardingCase_ID: onboardingCase.ID,
        mandatory: true,
        status: { in: ["Required", "Submitted"] },
      }),
    );
    if (openDocs.length > 0) {
      return req.error(
        400,
        `Onboarding cannot be completed: ${openDocs.length} mandatory document(s) not verified (${openDocs
          .map((d) => d.documentType)
          .join(", ")}).`,
      );
    }

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "Completed", completedAt: new Date().toISOString(), progress: 100 })
        .where({ ID: onboardingCase.ID }),
    );
    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, { status: "Completed" });
    await notify(tx, {
      recipientId: onboardingCase.reportingManager_ID,
      title: `Onboarding ${onboardingCase.onboardingNumber} completed`,
      message: `Onboarding is complete. The candidate can now be converted into an employee (ConvertToEmployee).`,
      category: "RECRUITMENT",
      priority: "Medium",
      sourceModule: "RECRUITMENT",
      sourceEntity: "OnboardingCase",
      sourceRecordId: onboardingCase.ID,
    });
    return "Onboarding completed.";
  });

  srv.on("CancelOnboarding", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await loadCase(req, tx, keysOf(req));
    if (!onboardingCase) return;
    assertTransition(req, onboardingCase.status, "Cancelled", CASE_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "Cancelled", notes: req.data.comments || onboardingCase.notes })
        .where({ ID: onboardingCase.ID }),
    );
    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, { status: "Cancelled" });
    return "Onboarding cancelled.";
  });

  // ----------------------------------------------------------
  // TASK actions
  // ----------------------------------------------------------
  srv.on("StartTask", TASK_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const loaded = await loadTask(req, tx);
    if (!loaded) return;
    const { task, onboardingCase } = loaded;

    const activeCase = await assertCaseInProgress(req, tx, task.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, task.status, "InProgress", TASK_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(TASK_DB).set({ status: "InProgress" }).where({ ID: task.ID }),
    );
    return "Task started.";
  });

  srv.on("CompleteTask", TASK_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const loaded = await loadTask(req, tx);
    if (!loaded) return;
    const { task, onboardingCase } = loaded;

    const activeCase = await assertCaseInProgress(req, tx, task.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, task.status, "Completed", TASK_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(TASK_DB)
        .set({
          status: "Completed",
          completedAt: new Date().toISOString(),
          completedBy_ID: req.user?.attr?.employeeId || null,
          notes: req.data.comments || task.notes,
        })
        .where({ ID: task.ID }),
    );
    const progress = await recalculateProgress(tx, task.onboardingCase_ID);
    await persistAudit(req, "UPDATE", "OnboardingTasks", task, { status: "Completed" });
    return `Task completed. Onboarding progress: ${progress}%.`;
  });

  // Skipping a MANDATORY task is never allowed - otherwise the
  // mandatory guard in CompleteOnboarding would be meaningless.
  srv.on("SkipTask", TASK_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const loaded = await loadTask(req, tx);
    if (!loaded) return;
    const { task, onboardingCase } = loaded;

    const activeCase = await assertCaseInProgress(req, tx, task.onboardingCase_ID);
    if (!activeCase) return;

    if (task.mandatory) {
      return req.error(
        400,
        `Mandatory task '${task.title}' cannot be skipped. Complete it or keep the case open.`,
      );
    }
    assertTransition(req, task.status, "Skipped", TASK_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(TASK_DB)
        .set({ status: "Skipped", notes: req.data.comments || task.notes })
        .where({ ID: task.ID }),
    );
    await recalculateProgress(tx, task.onboardingCase_ID);
    return "Task skipped.";
  });

  srv.on("BlockTask", TASK_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const loaded = await loadTask(req, tx);
    if (!loaded) return;
    const { task, onboardingCase } = loaded;

    const activeCase = await assertCaseInProgress(req, tx, task.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, task.status, "Blocked", TASK_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(TASK_DB)
        .set({ status: "Blocked", notes: req.data.comments || task.notes })
        .where({ ID: task.ID }),
    );
    return "Task blocked.";
  });

  // Reopen returns a Completed/Skipped/Blocked task to Pending.
  srv.on("ReopenTask", TASK_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const loaded = await loadTask(req, tx);
    if (!loaded) return;
    const { task, onboardingCase } = loaded;

    const activeCase = await assertCaseInProgress(req, tx, task.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, task.status, "Pending", TASK_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(TASK_DB)
        .set({ status: "Pending", completedAt: null, completedBy_ID: null })
        .where({ ID: task.ID }),
    );
    await recalculateProgress(tx, task.onboardingCase_ID);
    return "Task reopened.";
  });

  // ----------------------------------------------------------
  // DOCUMENT REQUIREMENT actions
  // ----------------------------------------------------------
  srv.on("SubmitDocument", DOC_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDoc(req, tx);
    if (!doc) return;

    const activeCase = await assertCaseInProgress(req, tx, doc.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, doc.status, "Submitted", DOC_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(DOC_DB)
        .set({ status: "Submitted", submittedOn: new Date().toISOString(), notes: req.data.notes || doc.notes })
        .where({ ID: doc.ID }),
    );
    return "Document submitted.";
  });

  srv.on("VerifyDocument", DOC_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDoc(req, tx);
    if (!doc) return;

    const activeCase = await assertCaseInProgress(req, tx, doc.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, doc.status, "Verified", DOC_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(DOC_DB)
        .set({
          status: "Verified",
          verifiedOn: new Date().toISOString(),
          verifiedBy_ID: req.user?.attr?.employeeId || null,
          notes: req.data.notes || doc.notes,
        })
        .where({ ID: doc.ID }),
    );
    return "Document verified.";
  });

  srv.on("RejectDocument", DOC_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDoc(req, tx);
    if (!doc) return;

    const activeCase = await assertCaseInProgress(req, tx, doc.onboardingCase_ID);
    if (!activeCase) return;
    assertTransition(req, doc.status, "Rejected", DOC_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(DOC_DB)
        .set({ status: "Rejected", notes: req.data.notes || doc.notes })
        .where({ ID: doc.ID }),
    );
    return "Document rejected.";
  });

  // Waive = explicit HR exemption. Non-mandatory documents may be
  // waived; waiving a mandatory one would silently weaken the
  // completion guard, so only optional docs can be waived here.
  srv.on("WaiveDocument", DOC_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDoc(req, tx);
    if (!doc) return;

    const activeCase = await assertCaseInProgress(req, tx, doc.onboardingCase_ID);
    if (!activeCase) return;

    if (doc.mandatory) {
      return req.error(
        400,
        `Mandatory document '${doc.documentType}' cannot be waived. It must be submitted and verified.`,
      );
    }
    assertTransition(req, doc.status, "Waived", DOC_TRANSITIONS);
    if (req.errors?.length) return;

    await tx.run(
      UPDATE(DOC_DB)
        .set({ status: "Waived", notes: req.data.notes || doc.notes })
        .where({ ID: doc.ID }),
    );
    return "Document waived.";
  });
};
