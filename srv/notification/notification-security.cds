using NotificationService from './notification-service';

// ============================================================
// SPRINT 11/12 - NOTIFICATION SECURITY (reuses Sprint 9 model)
// ------------------------------------------------------------
// No new security framework - the same roles defined in
// package.json / xs-security.json and srv/common/auth/roles.js
// apply here.
//
// Design decisions:
//  * Notifications are PRIVATE messages. Every role (including
//    managers and HR) may only READ the rows where they are the
//    recipient - enforced with the $user where-clause below.
//    There is deliberately NO unrestricted admin read grant:
//    even administrators should not casually read other users'
//    private messages through the API.
//  * Read status changes only through the MarkAsRead action
//    (ownership re-checked in the handler - defense in depth).
//  * Creating notifications directly is SystemAdmin-only
//    (business modules use the internal notify() helper).
//  * Direct UPDATE/DELETE is blocked by handlers in
//    notification-service.js; notifications are retained.
// ============================================================

annotate NotificationService with @(requires: 'authenticated-user');

// Everyone may only see their OWN notifications.
annotate NotificationService.Notifications with @restrict: [
    { grant: ['READ'],       to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'], where: 'recipient_ID = $user.employeeId' },
    { grant: ['MarkAsRead'], to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] }
];

// Creating notifications via the API is an admin back-door for
// tests/tools; business modules create notifications internally.
annotate NotificationService.CreateNotification with @(requires: ['SystemAdmin']);
