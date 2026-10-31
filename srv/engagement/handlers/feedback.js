const cds = require("@sap/cds");
const { SELECT, INSERT } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");
const { hasRole } = require("../../common/auth/authorization");

// ============================================================
// SPRINT 18 - FEEDBACK (SUGGESTIONS) + RECOGNITION HANDLERS
// ------------------------------------------------------------
// Beginner summary:
//
//   SUGGESTIONS (NOT anonymous - a deliberate, documented design):
//     * submittedBy is ALWAYS the logged-in user (payload is
//       ignored) - employees cannot submit "for a colleague".
//     * HR trio sees everything; the submitter sees their own.
//     * Lifecycle Submitted -> InReview -> Accepted/Rejected/Closed
//       ONLY through the Resolve action (HR). Direct PATCH cannot
//       move the status or fake a review.
//     * While still in 'Submitted' the author may enrich their own
//       message/notes; after the review stage the row locks.
//     * A reviewer decision notifies the submitter (dedupe: one
//       row per suggestion + status; retries cannot duplicate).
//
//   RECOGNITIONS:
//     * fromEmployee is ALWAYS the logged-in user; sending kudos
//       to yourself is refused; the recipient must exist.
//     * future dates are refused - appreciation is for something
//       that already happened.
//     * moderation (hide/delete) is HRAdmin/SystemAdmin only and
//       keeps a note (audit).
// ============================================================

const SUGGESTION_ENTITY = "ewms.db.engagement.Suggestion";
const RECOGNITION_ENTITY = "ewms.db.engagement.Recognition";

const SUGGESTION_STATUSES = ["Submitted", "InReview", "Accepted", "Rejected", "Closed"];
// The forward-only transition map of a suggestion lifecycle.
const NEXT_SUGGESTION_STATUSES = {
  Submitted: ["InReview", "Accepted", "Rejected", "Closed"],
  InReview: ["Accepted", "Rejected", "Closed"],
  Accepted: ["Closed"],
  Rejected: [],
  Closed: [],
};

function ownEmployeeId(req) {
  return req.user?.attr?.employeeId ?? req.user?.employeeId;
}

void hasRole;

module.exports = (srv) => {
  const { Suggestions, Recognitions } = srv.entities;

  // ============================================================
  // SUGGESTIONS
  // ============================================================
  srv.before("CREATE", Suggestions, async (req) => {
    const employeeId = ownEmployeeId(req);
    if (!employeeId) {
      req.reject(403, "Your user is not linked to an employee record.");
    }
    if (!req.data.subject) req.reject(400, "Suggestion subject is required.");
    if (!req.data.message) req.reject(400, "Suggestion message is required.");
    if (!req.data.category) req.reject(400, "Suggestion category is required.");

    // Identity is server-set: payload `submittedBy_ID` is IGNORED.
    // (The self-write guard would reject the normal case anyway;
    // overriding here makes spoofing structurally impossible.)
    req.data.submittedBy_ID = employeeId;
    // A new row always starts in Submitted.
    req.data.status = "Submitted";
  });

  srv.before("UPDATE", Suggestions, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const current = await tx.run(SELECT.one.from(SUGGESTION_ENTITY).where({ ID: id }));
    if (!current) {
      const e = new Error("Suggestion not found.");
      e.status = 404;
      throw e;
    }

    // Lifecycle fields are HR-only via Resolve.
    const lifecyclePatch =
      req.data.status != null ||
      req.data.reviewedOn != null ||
      req.data.reviewOutcome != null ||
      ("reviewedBy_ID" in req.data && req.data.reviewedBy_ID !== null);
    if (lifecyclePatch) {
      if (!hasRole(req, "HRExecutive", "HRAdmin", "SystemAdmin")) {
        req.reject(403, "Only HR can change the review status.");
      }
      req.reject(400, "Review decisions go through the Resolve action.");
    }

    // After review started, the row locks for everyone (the
    // original suggestion must not change under the reviewer).
    if (current.status !== "Submitted") {
      req.reject(400, "A suggestion in review cannot be edited.");
    }

    // Ownership: authors may only enrich their OWN still-open row.
    if (String(current.submittedBy_ID) !== String(ownEmployeeId(req))
        && !hasRole(req, "HRAdmin", "SystemAdmin", "HRExecutive")) {
      req.reject(403, "You may only edit your own suggestion.");
    }
  });

  srv.on("Resolve", Suggestions, async (req) => {
    const tx = cds.transaction(req);
    const newStatus = req.data.newStatus;

    if (!SUGGESTION_STATUSES.includes(newStatus)) {
      req.reject(400, `Unknown review status "${newStatus}".`);
    }

    const suggestion = await tx.run(
      SELECT.one.from(SUGGESTION_ENTITY).where({ ID: req.params?.[0]?.ID ?? req.params?.[0] }),
    );
    if (!suggestion) req.reject(404, "Suggestion not found.");

    if (newStatus === suggestion.status) {
      req.reject(409, `The suggestion is already ${newStatus}.`);
    }
    if (!NEXT_SUGGESTION_STATUSES[suggestion.status]?.includes(newStatus)) {
      req.reject(
        409,
        `A suggestion in "${suggestion.status}" cannot move to "${newStatus}" (allowed: ${NEXT_SUGGESTION_STATUSES[suggestion.status].join(", ") || "none"}).`,
      );
    }

    await tx.run(
      UPDATE(SUGGESTION_ENTITY).where({ ID: suggestion.ID }).with({
        status: newStatus,
        reviewOutcome: req.data.outcome ?? null,
        reviewedOn: new Date().toISOString(),
        reviewedBy_ID: ownEmployeeId(req) ?? undefined,
      }),
    );

    // Notify the submitter exactly once per suggestion+status
    // (dedupe query before insert; retry-safe like Sprint 17).
    const existing = await tx.run(
      SELECT.one.from("ewms.db.notification.Notification").where({
        recipient_ID: suggestion.submittedBy_ID,
        sourceRecordId: suggestion.ID,
        title: `Your suggestion "${suggestion.subject}" was ${newStatus.toLowerCase()}`,
      }),
    );
    if (!existing) {
      await notify(tx, {
        recipientId: suggestion.submittedBy_ID,
        title: `Your suggestion "${suggestion.subject}" was ${newStatus.toLowerCase()}`,
        message: req.data.outcome?.slice(0, 500) || `The review status is now "${newStatus}".`,
        category: "ENGAGEMENT",
        priority: "Medium",
        sourceModule: "ENGAGEMENT",
        sourceEntity: SUGGESTION_ENTITY,
        sourceRecordId: suggestion.ID,
      });
    }

    return `Suggestion ${suggestion.ID} is now ${newStatus}.`;
  });

  // ============================================================
  // RECOGNITIONS
  // ============================================================
  srv.before("CREATE", Recognitions, async (req) => {
    const employeeId = ownEmployeeId(req);
    if (!employeeId) {
      req.reject(403, "Your user is not linked to an employee record.");
    }
    if (!req.data.toEmployee_ID) req.reject(400, "Recognition recipient is required.");
    if (!req.data.category) req.reject(400, "Recognition category is required.");
    if (!req.data.message) req.reject(400, "Recognition message is required.");

    const t = new Date().toISOString().slice(0, 10);
    if (req.data.recognitionDate && req.data.recognitionDate > t) {
      req.reject(400, "Recognition date cannot be in the future.");
    }

    // Sender identity is server-set (payload ignored, same reason
    // as suggestions). Self-kudos is refused: it is not engagement.
    req.data.fromEmployee_ID = employeeId;
    if (String(req.data.toEmployee_ID) === String(employeeId)) {
      req.reject(400, "You cannot send a recognition to yourself.");
    }

    // The recipient must be a real employee row.
    const recipient = await tx(req).run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: req.data.toEmployee_ID }),
    );
    if (!recipient) req.reject(404, "Recognition recipient not found.");

    // Duplicate guard (retry-safe double-click): same sender ->
    // same recipient, same category and same message text on the
    // same day is treated as a repeat click, not a new kudos.
    const duplicate = await tx(req).run(
      SELECT.one.from(RECOGNITION_ENTITY).where({
        fromEmployee_ID: employeeId,
        toEmployee_ID: req.data.toEmployee_ID,
        category: req.data.category,
        message: req.data.message,
        recognitionDate: req.data.recognitionDate || t,
      }),
    );
    if (duplicate) {
      req.reject(409, "This recognition was already sent (exact same content on the same day).");
    }

    // The recipient learns about the kudos through the shared
    // notification core (one row per recognition record, and the
    // exact-duplicate reject above keeps retries from spamming).
    await notify(tx(req), {
      recipientId: req.data.toEmployee_ID,
      title: `Recognition from a colleague: ${req.data.category}`,
      message: `You received recognition for ${req.data.category}: "${String(req.data.message).slice(0, 180)}"`,
      category: "ENGAGEMENT",
      priority: "Medium",
      sourceModule: "ENGAGEMENT",
      sourceEntity: RECOGNITION_ENTITY,
      sourceRecordId: req.data.ID ?? null,
    });
  });

  srv.before("UPDATE", Recognitions, async (req) => {
    // Moderate = deactivate with a note; everything else (message,
    // recipient, sender) is immutable. Role grant restricts to HR.
    // Key/metadata fields that CAP always adds to a PATCH payload.
    const ignorable = new Set(["ID", "IsActiveEntity", "HasActiveEntity", "DraftAdministrativeData"]);
    const editable = ["status", "moderationNote", "moderatedBy_ID", "moderatedOn"];
    const touched = Object.keys(req.data).filter(
      (k) => req.data[k] !== undefined && !ignorable.has(k),
    );
    const illegal = touched.filter((k) => !editable.includes(k));
    if (illegal.length) {
      req.reject(400, `Recognition content cannot be modified directly (fields: ${illegal.join(", ")}). Archive/hide via status instead.`);
    }
  });

  // Stamp moderation metadata for admin status changes.
  srv.before("UPDATE", "Recognitions", async (req) => {
    if (req.data.status != null) {
      req.data.moderatedBy_ID = ownEmployeeId(req) ?? undefined;
      req.data.moderatedOn = new Date().toISOString();
    }
  });
};

/** Small helper: derive a runnable tx from the request. */
function tx(reqOrAnything) {
  return cds.transaction(reqOrAnything);
}
