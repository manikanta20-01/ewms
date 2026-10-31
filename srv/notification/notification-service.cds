using { ewms.db.notification as db } from '../../db/schema';

// ============================================================
// SPRINT 11/12 - NOTIFICATION SERVICE (MINIMAL CORE)
// ------------------------------------------------------------
// One shared service for the whole application. Business modules
// (Recruitment today, Leave/Payroll/Workflow in later phases)
// create notifications through the notify(...) helper - users
// read and manage their OWN notifications through this service.
//
// Security lives in notification-security.cds and reuses the
// Sprint 9 roles. The row-level rule "you only ever see YOUR
// notifications" is enforced with a $user where-clause there.
// ============================================================

service NotificationService @(requires: 'authenticated-user') {

    // ---------------------------------------------------------
    // The user's own inbox. Standard OData gives filtering
    // ($filter=status eq 'Unread'), pagination ($top/$skip) and
    // counting for free - no custom APIs needed for those.
    // ---------------------------------------------------------
    entity Notifications as projection on db.Notification actions {
        // Mark one of MY notifications as read. Idempotent:
        // marking an already-read notification changes nothing.
        action MarkAsRead() returns String;
    };

    // ---------------------------------------------------------
    // Admin-only unbound action to create a notification directly
    // (used by tests/tools). Business modules call the notify()
    // helper internally instead - see notification-core.js.
    // Restricted to SystemAdmin in notification-security.cds so
    // normal users can never forge messages to other users.
    // ---------------------------------------------------------
    action CreateNotification(
        recipient_ID : UUID,
        title        : String(200),
        message      : String(1000),
        category     : String(20),
        priority     : String(10),
        sourceModule : String(50),
        sourceEntity : String(100),
        sourceRecordId : UUID,
        actionLink   : String(255)
    ) returns String;
}
