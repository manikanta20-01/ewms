const cds = require("@sap/cds");
const { INSERT } = cds.ql;

// ============================================================
// SPRINT 11/12 - NOTIFICATION CORE (REUSABLE HELPER)
// ------------------------------------------------------------
// This is the ONE function every business module uses to inform
// a user. Recruitment (Sprint 12) calls it for offer and
// onboarding events; later sprints can call it the same way.
//
// WHY a shared helper:
//   * Leave, Payroll, Workflow and Recruitment must not each
//     build their own notification logic - one place guarantees
//     consistent status/category handling.
//   * A notification failure must never break the business
//     transaction: the offer is approved even if the inbox write
//     hiccups. That is why notify() swallows and logs errors
//     instead of throwing (documented trade-off).
//
// No template engine here (Sprint 11 Phase 2 can add templates
// on top): callers pass final title/message text.
// ============================================================

const NOTIFICATION_ENTITY = "ewms.db.notification.Notification";
const LOG = cds.log("notification");

/**
 * Creates one notification row inside the CURRENT transaction.
 *
 * @param txOrService  active transaction OR a CAP service instance
 *                      (cds.service.impl context) from which a tx is
 *                      derived via cds.transaction(...).
 * @param data  { recipientId, title, message, category, priority,
 *                sourceModule, sourceEntity, sourceRecordId, actionLink }
 * @returns the inserted notification ID or null when skipped
 */
async function notify(txOrService, data) {
  try {


    // Some callers pass a CAP service instance (the cds.service.impl
    // context) rather than a transaction. Derive a runnable tx from
    // it so the same helper works from actions, handlers, and from
    // exported module references alike.
    const tx =
      txOrService &&
      typeof txOrService.run === "function" &&
      txOrService.encode
        ? cds.transaction(txOrService)
        : txOrService;
    // Minimal validation: without recipient or text the row would
    // be useless garbage - skip instead of failing the caller.
    if (!data || !data.recipientId || !data.title || !data.message) {
      LOG.warn("notify() skipped: recipientId, title and message are required.");
      return null;
    }

    const ID = cds.utils.uuid();
    await tx.run(
      INSERT.into(NOTIFICATION_ENTITY).entries({
        ID,
        recipient_ID: data.recipientId,
        title: String(data.title).slice(0, 200),
        message: String(data.message).slice(0, 1000),
        category: data.category || "SYSTEM",
        priority: data.priority || "Medium",
        status: "Unread",
        sourceModule: data.sourceModule || null,
        sourceEntity: data.sourceEntity || null,
        sourceRecordId: data.sourceRecordId || null,
        actionLink: data.actionLink || null,
      }),
    );
    return ID;
  } catch (err) {
    // Notification must never break the business action.
    LOG.error("notify() failed (business action continues):", err.message);
    return null;
  }
}

module.exports = { notify };
