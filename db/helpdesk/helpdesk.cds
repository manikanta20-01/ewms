namespace ewms.db.helpdesk;

using { managed } from '@sap/cds/common';

using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.organization.Department } from '../organization/department';

// ============================================================
// SPRINT 20 - HR SUPPORT / HELPDESK
// ------------------------------------------------------------
// Backend-only module built on the EXISTING Employee and
// Organization models - a support ticket is a person-level
// object, so privacy scoping (requester) IS the isolation
// mechanism; no company/legal-entity column is invented.
//
// Beginner summary of the four tables:
//
//   * HRTicket             - the request itself (code, subject,
//                            category, priority, status, assignee,
//                            resolution trail). Status can ONLY be
//                            moved by the bound actions; nobody has
//                            UPDATE/DELETE grants.
//   * HRTicketComment      - the conversation. THREE kinds:
//        InternalNote      - agents only, NEVER shown to the
//                            requester (server-side filter).
//        AgentResponse     - reply the requester may read;
//                            stamps the ticket's firstResponseAt
//                            (SLA measurement input).
//        EmployeeResponse  - the requester's answer; when the
//                            ticket is WaitingForEmployee this
//                            automatically moves it back to
//                            InProgress.
//   * HRTicketEvent        - append-only history (status changes,
//                            assignments/reassignments, priority
//                            changes, reopen). Never edited, never
//                            deleted - reopen "preserves history"
//                            because it just appends.
//   * HRTicketCategorySLA  - CONFIGURABLE (never hardcoded) per
//                            category response/resolution targets
//                            in hours. null = no target for that
//                            category: the ticket can never be
//                            overdue on that axis.
//
// Ticket lifecycle (enforced in srv/helpdesk/handlers):
//
//   New -> Assigned -> InProgress -> WaitingForEmployee
//                 \\\\-> Resolved -> Closed
//   Resolved -> Closed (requester confirms) or directly back to
//   InProgress via Reopen. Every reopen keeps the full history.
// ============================================================

entity HRTicket : managed {
    key ID : UUID;

    // Server-generated business code (TCK0001, TCK0002, ...).
    ticketCode : String(20) not null;

    // ALWAYS the logged-in caller (server-set; payload ignored).
    // Users without an employee record (e.g. SystemAdmin) must
    // nominate the requesting employee explicitly.
    requester : Association to Employee not null;

    // Denormalized from the requester for simple list screens -
    // informational only, never used for access decisions (the
    // requester scoping is).
    requesterDepartment : Association to Department;

    category : enums.HRTicketCategory not null;

    subject    : String(150) not null;
    description : String(2000) not null;

    priority : enums.HRTicketPriority default 'Medium';
    status   : enums.HRTicketStatus default 'New';

    // Assigned support agent (an Employee record). Set ONLY by
    // the Assign action (assignment history in HRTicketEvent).
    assignee   : Association to Employee;
    assignedOn : Timestamp;

    // SLA measurement timestamps (B8). Actual durations arise
    // from these; claim nothing automatic.
    firstResponseAt : Timestamp;
    resolvedOn      : Timestamp;
    closedOn        : Timestamp;

    // Written by the Resolve action (required there).
    resolutionNotes : String(2000);

    // Optional attachment referencing the EXISTING Sprint 17
    // document storage by ID. Deliberately a plain reference (NOT
    // an Association): the Document entity stays exposed ONLY by
    // the employee service (its authorized, secure path); an
    // auto-exposed helpdesk Document projection would leak the
    // employee document surface. Ownership is validated in the
    // create handler - the actor may reference only own documents
    // (or HR any). Nothing is stored twice.
    attachedDocument_ID : UUID;

    // Duplicate-safe creation: the SAME clientRequestId never
    // creates a second ticket (safe retries).
    clientRequestId : String(100);

    comments : Composition of many HRTicketComment
        on comments.ticket = $self;
    events : Composition of many HRTicketEvent
        on events.ticket = $self;
}

entity HRTicketComment : managed {
    key ID : UUID;

    ticket : Association to HRTicket not null;

    // Server-set - a comment identity is never spoofable.
    author : Association to Employee not null;

    kind : enums.HRTicketCommentKind not null;
    text : String(2000) not null;

    // Immutable after creation (no UPDATE/DELETE grants; the
    // history is what a reopened ticket is judged on).
}

entity HRTicketEvent : managed {
    key ID : UUID;

    ticket : Association to HRTicket not null;

    // e.g. 'Created', 'Assigned', 'Reassigned', 'StatusChange',
    // 'PriorityChanged', 'Reopened', 'Comment' (free-form label;
    // kept as plain String on purpose so later events do not
    // require enum migrations).
    eventType  : String(30) not null;

    actor : Association to Employee;
    reason : String(500);

    fromStatus : enums.HRTicketStatus;
    toStatus   : enums.HRTicketStatus;

    fromAssignee : Association to Employee;
    toAssignee   : Association to Employee;
}

// CONFIGURABLE SLA targets (B4/B8): one row per category, HR
// maintained. Hours are business hours-agnostic wall-clock
// hours (no schedule/hector awareness - documented limitation).
entity HRTicketCategorySLA : managed {
    key ID : UUID;

    // Exactly ONE row per category.
    category : enums.HRTicketCategory not null @assert.unique;

    // null = no target on that axis (its overdue check simply
    // never fires). Nothing is defaulted by code - targets are a
    // business configuration, not a legal claim.
    responseTargetHours   : Integer;
    resolutionTargetHours : Integer;

    // Inactive rows are ignored by the overdue computation.
    active : Boolean default true;
}
