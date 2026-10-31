const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

// ============================================================
// SPRINT 11/12 - NOTIFICATION SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Implements the two actions declared in notification-service.cds:
//
//  * CreateNotification - the SystemAdmin-only back-door used by
//    tests/tools. Business modules create notifications internally
//    through the shared notify() helper (notification-core.js).
//
//  * MarkAsRead - the ONE way a user marks their OWN notification
//    as read (idempotent: marking an already-read notification
//    changes nothing). Ownership is re-checked here even though
//    notification-security.cds already restricts READ/MARKASREAD
//    to recipient_ID = $user.employeeId - defense in depth, and
//    it also guards delegation-style bypasses the where-clause
//    cannot express.
//
// Direct CREATE/UPDATE/DELETE on the Notifications entity set is
// deliberately not enabled: the inbox is written by business
// modules and mutated only through MarkAsRead.
// ============================================================

const NOTIFICATION_ENTITY = "ewms.db.notification.Notification";

/** Bound-action / bound-CRUD key predicate. req.params[0] may be a
 *  RAW UUID string (CAP 8) - it must be wrapped as { ID } before
 *  it goes into .where(), else CQN parses the UUID as an
 *  arithmetic expression and crashes. */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

module.exports = cds.service.impl((srv) => {
  // ----------------------------------------------------------
  // SystemAdmin back-door: create a notification directly.
  // ----------------------------------------------------------
  srv.on("CreateNotification", async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.recipient_ID || !req.data.title || !req.data.message) {
      return req.error(
        400,
        "recipient_ID, title and message are required for a notification.",
      );
    }

    const ID = cds.utils.uuid();
    await tx.run(
      INSERT.into(NOTIFICATION_ENTITY).entries({
        ID,
        recipient_ID: req.data.recipient_ID,
        title: String(req.data.title).slice(0, 200),
        message: String(req.data.message).slice(0, 1000),
        category: req.data.category || "SYSTEM",
        priority: req.data.priority || "Medium",
        status: "Unread",
        sourceModule: req.data.sourceModule || null,
        sourceEntity: req.data.sourceEntity || null,
        sourceRecordId: req.data.sourceRecordId || null,
        actionLink: req.data.actionLink || null,
      }),
    );

    return ID;
  });

  // ----------------------------------------------------------
  // Mark one of MY notifications as read. Idempotent.
  // ----------------------------------------------------------
  srv.on("MarkAsRead", srv.entities.Notifications, async (req) => {
    const tx = cds.transaction(req);

    const row = await tx.run(
      SELECT.one.from(NOTIFICATION_ENTITY).where(keysOf(req)),
    );
    if (!row) {
      return req.error(404, "Notification not found.");
    }

    // Ownership re-check (defense in depth on top of the
    // notification-security.cds where-clause).
    const me = req.user?.attr?.employeeId;
    if (!me || row.recipient_ID !== me) {
      return req.error(
        403,
        "You can only manage your own notifications.",
      );
    }

    // Idempotent: already-read notifications stay untouched.
    if (row.status !== "Read") {
      await tx.run(
        UPDATE(NOTIFICATION_ENTITY)
          .set({ status: "Read", readAt: new Date().toISOString() })
          .where({ ID: row.ID }),
      );
    }

    return "Read";
  });
});
