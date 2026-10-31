namespace ewms.db.notification;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';

// ============================================================
// SPRINT 11/12 - NOTIFICATION EXTENSION POINT (MINIMAL CORE)
// ------------------------------------------------------------
// Sprint 11 was left incomplete, so Sprint 12 ships the MINIMAL
// reusable notification core that the offer/onboarding handlers
// need - one shared table, one service, one helper function.
//
// It is deliberately NOT the full Sprint 11 scope (no templates,
// no preferences, no unread-count actions yet). Sprint 11 Phase 2
// can extend this file and service without touching business
// modules, because business code only calls notify(...) from
// srv/notification/handlers/notification-core.js.
//
// WHY one shared table: Leave, Payroll, Workflow and Recruitment
// must never each build their own notification store - who was
// notified, with which message, and whether it was read is a
// cross-module concern.
// ============================================================

entity Notification : managed {
    key ID : UUID;

    // WHO receives the notification - always an existing employee.
    recipient : Association to Employee not null;

    // WHAT the notification says.
    title : String(200) not null;
    message : String(1000) not null;

    // WHICH business area raised it (LEAVE, PAYROLL, RECRUITMENT...).
    category : enums.NotificationCategory not null default 'SYSTEM';
    priority : enums.NotificationPriority default 'Medium';

    // Read lifecycle: Unread -> Read (one-way).
    status : enums.NotificationStatus default 'Unread';
    readAt : Timestamp;

    // WHERE it came from - lets a future Fiori app deep-link to
    // the business object (e.g. open the offer behind a message).
    sourceModule : String(50);
    sourceEntity : String(100);
    sourceRecordId : UUID;
    actionLink : String(255);

    // Optional expiry for future cleanup jobs (Sprint 20).
    expiresAt : Timestamp;
}
