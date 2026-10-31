using { ewms.db.helpdesk as db } from '../../db/schema';

// ============================================================
// SPRINT 20 - HR SUPPORT / HELPDESK (SERVICE)
// ------------------------------------------------------------
// One service, four concerns - all backend-only, built on the
// EXISTING Employee/Document models:
//
//   1. HRTickets          - create/view your own requests; the
//                           WHOLE lifecycle (assign -> progress ->
//                           wait -> resolve -> close, plus reopen)
//                           runs through bound actions ONLY.
//                           Nobody has UPDATE/DELETE grants, so a
//                           direct PATCH can never move a status.
//
//   2. HRTicketComments   - the conversation, split into kinds:
//                           internal agent notes never reach the
//                           requester (server-side filter, not a
//                           UI hide).
//
//   3. HRTicketEvents     - append-only assignment/status/
//                           priority/reopen history (HR-only
//                           read; the requester-visible history
//                           is the ticket fields itself).
//
//   4. OverdueTickets     - COMPUTED view over the CONFIGURED
//                           category SLA targets: which open
//                           tickets missed their response or
//                           resolution target. Escalation is
//                           manual readiness - the repo has no
//                           background scheduler, so nothing is
//                           claimed to run automatically.
// ============================================================

service HelpdeskService @(requires: 'authenticated-user') {

    entity HRTickets as projection on db.HRTicket actions {

        // Only supports agents (HR roles) move the ticket through
        // the working states; each action revalidates state and
        // actor server-side (see handlers).
        action Assign(agent_ID : UUID) returns String;

        // InProgress (only the assignee or HR).
        action Start() returns String;

        // WaitingForEmployee - the ticket needs the requester:
        // their next EmployeeResponse comment automatically puts
        // it back to InProgress (documented rule).
        action WaitForEmployee(reason : String(500)) returns String;

        // Resolved - resolutionNotes REQUIRED (quality rule).
        action Resolve(resolutionNotes : String(2000)) returns String;

        // Closed - the REQUESTER confirms the resolution (or HR
        // closes administratively). Only from Resolved.
        action Close() returns String;

        // Reopened: Resolved/Closed -> InProgress (assignee kept
        // if any). Reason required; full history preserved.
        action Reopen(reason : String(500)) returns String;

        // HR triage knob (recorded as an event, never silently).
        action ChangePriority(priority : String(20)) returns String;

        // One comment in one call. Employees may only write
        // EmployeeResponse on their OWN ticket; agents choose
        // InternalNote / AgentResponse. WaitingForEmployee +
        // EmployeeResponse = automatic return to InProgress.
        action AddComment(text : String(2000), kind : String(20))
            returns String;
    };

    // Read: own tickets for the requester, all for the HR trio
    // (see helpdesk-security.cds). Comments/events are separate
    // entities with their own privacy rules.
    entity HRTicketComments as projection on db.HRTicketComment;

    // Append-only history. Never exposed to requesters: internal
    // routing/reassignment details are HR-only information.
    entity HRTicketEvents as projection on db.HRTicketEvent;

    // Configurable SLA targets per category, HR-maintained
    // (nullable = no target). No defaults are hardcoded.
    entity HRTicketSLAConfigs as projection on db.HRTicketCategorySLA;

    // COMPUTED at read time (never stale): open tickets past
    // their configured response or resolution target. HR-only -
    // overdue lists are workforce-support data, not requester
    // data (same line-of-sight rule as Sprints 17/19 reporting).
    entity OverdueTickets @(cds.persistence.skip) {
        key ticket_ID    : UUID;
        ticketCode       : String(20);
        category         : String(30);
        priority         : String(20);
        status           : String(30);
        subject          : String(150);
        requester_ID     : UUID;
        assignee_ID      : UUID;
        createdAt        : Timestamp;
        targetHours      : Integer;   // the one that was missed
        overdueType      : String(20); // 'Response' | 'Resolution'
        hoursOverdue     : Integer;
    }
}
