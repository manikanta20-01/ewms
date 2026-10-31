const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");
const { persistAudit } = require("../../common/utils/audit");
const { generateCode } = require("../../common/utils/code-generator");
const {
  TICKET_ENTITY,
  EVENT_ENTITY,
  OPEN_STATUSES,
  PRIORITIES,
  isHR,
  ownEmployeeId,
  latestDepartmentId,
  notifyDepartmentHR,
} = require("./helpdesk-common");

// ============================================================
// SUPPORT-20 - TICKET LIFECYCLE HANDLERS
// ------------------------------------------------------------
// Beginner summary of the rules implemented here:
//
//   * Direct writes are BLOCKED: PATCH can never move a status,
//     change an assignee or rewrite resolution notes - the
//     perimeter and the workflow are the same perimeter (only
//     the bound actions below move the ticket).
//
//   * The requester is ALWAYS the logged-in user. Payload
//     "requester_ID" is ignored for normal employees (no
//     ticketing on behalf of colleagues); users without an
//     employee record (e.g. SystemAdmin) MUST nominate one.
//
//   * Duplicate-safe creation: the same clientRequestId from the
//     same requester returns a 409 pointing at the FIRST ticket -
//     the retry can never create a second one.
//
//   * Every mutation appends an immutable HRTicketEvent row and
//     audits through the shared persistAudit helper.
//
//   * Idempotent actions: re-Assign to the same agent and
//     ChangePriority to the same priority return a friendly
//     message WITHOUT a duplicate event/notification.
//
//   * Notifications ride the shared notify() core (category
//     SUPPORT) and never contain the (sensitive) description.
// ============================================================

module.exports = (srv) => {
  const { HRTickets } = srv.entities;

  const now = () => new Date().toISOString();

  // ============================================================
  // CREATION (guards + server-stamped fields)
  // ============================================================
  srv.before("CREATE", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const data = req.data;

    if (!data.category) req.reject(400, "Category is required.");
    if (!data.subject) req.reject(400, "Subject is required.");
    if (data.description == null || data.description === "")
      req.reject(400, "Description is required.");
    if (data.priority && !PRIORITIES.includes(data.priority))
      req.reject(400, `Priority must be one of: ${PRIORITIES.join(", ")}.`);

    // Requester = the caller: users WITH a resolvable employee
    // record always create for THEMSELVES (payload spoofing
    // ignored - no ticketing on behalf of colleagues). Only users
    // whose attribute does not match a real employee row (e.g.
    // SystemAdmin) may NOMINATE a requester (admin-assisted).
    let requesterId = ownEmployeeId(req);
    const employeeFor = (id) =>
      tx.run(SELECT.one.from("ewms.db.employee.Employee").where({ ID: id }));
    let employee = requesterId ? await employeeFor(requesterId) : null;
    if (!employee) {
      const nominee = data.requester_ID ?? data.requester ?? null;
      if (!nominee) {
        req.reject(403, "Your user is not linked to an employee record; nominate the requesting employee.");
      }
      const nominated = await employeeFor(nominee);
      if (!nominated) req.reject(400, "The nominated requester does not exist.");
      requesterId = nominee;
      employee = nominated;
    }

    // Same requester + same clientRequestId = already created.
    if (data.clientRequestId) {
      const duplicate = await tx.run(
        SELECT.one
          .from(TICKET_ENTITY)
          .where({ clientRequestId: data.clientRequestId, requester_ID: requesterId }),
      );
      if (duplicate)
        req.reject(409, `Request already registered as ${duplicate.ticketCode}. Safe retry: use that ticket.`);
    }

    // Server-generated business code (TCK0001-style sequence).
    if (!data.ticketCode) {
      data.ticketCode = await generateCode(req, TICKET_ENTITY, "ticketCode", "TCK", 4);
    }

    // Attachment (optional): MUST be an existing Sprint 17
    // document owned by the requester (reuse, never duplicate).
    if (data.attachedDocument || data.attachedDocument_ID) {
      const docId = data.attachedDocument_ID ?? data.attachedDocument;
      const doc = await tx.run(
        SELECT.one.from("ewms.db.employee.Document").where({ ID: docId }),
      );
      if (!doc) req.reject(400, "Attached document does not exist.");
      if (String(doc.employee_ID) !== String(requesterId) && !isHR(req)) {
        req.reject(403, "You may only attach one of your own documents.");
      }
    }

    data.requester_ID = requesterId;
    data.requesterDepartment_ID = await latestDepartmentId(tx, requesterId);
    data.ID = data.ID ?? cds.utils.uuid();
    data.status = "New";
  });

  srv.after("CREATE", HRTickets, async (ticket, req) => {
    const tx = cds.transaction(req);
    const t = now().slice(0, 10);

    // The ticket IS the history start: a 'Created' event row.
    await tx.run(
      INSERT.into(EVENT_ENTITY).entries({
        ID: cds.utils.uuid(),
        ticket_ID: ticket.ID,
        eventType: "Created",
        actor_ID: (await actorId(tx, req)) ?? ticket.requester_ID,
        toStatus: "New",
      }),
    );

    // Route to the ACTIVE DepartmentHR representatives (if any
    // are configured for the requester's department).
    await notifyDepartmentHR(
      tx,
      ticket.requesterDepartment_ID,
      {
        title: `New HR support request ${ticket.ticketCode}`,
        message: `A new ${ticket.category} support request was submitted (subject: "${String(ticket.subject).slice(0, 100)}").`,
        category: "SUPPORT",
        priority: ticket.priority,
        sourceModule: "Helpdesk",
        sourceEntity: "HRTicket",
        sourceRecordId: ticket.ID,
      },
      t,
    );
  });

  // --------------------------------------------------------------
  // The event actor must be a REAL employee row; users without an
  // employee record (SystemAdmin) keep their ticket-scoped actor
  // null rather than writing a dangling reference.
  // --------------------------------------------------------------
  async function actorId(tx, req) {
    const me = ownEmployeeId(req);
    if (!me) return null;
    const emp = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: me }),
    );
    return emp ? me : null;
  }

  async function loadTicket(tx, id) {
    return tx.run(SELECT.one.from(TICKET_ENTITY).where({ ID: id }));
  }

  async function appendEvent(tx, req, ticket, changes) {
    await tx.run(
      INSERT.into(EVENT_ENTITY).entries({
        ID: cds.utils.uuid(),
        ticket_ID: ticket.ID,
        eventType: changes.eventType,
        actor_ID: changes.actor === undefined ? await actorId(tx, req) : (changes.actor ?? null),
        reason: changes.reason ?? null,
        fromStatus: changes.fromStatus ?? null,
        toStatus: changes.toStatus ?? null,
        fromAssignee_ID: changes.fromAssignee ?? null,
        toAssignee_ID: changes.toAssignee ?? null,
      }),
    );
  }

  async function setTicket(tx, id, fields) {
    await tx.run(UPDATE(TICKET_ENTITY, id).set(fields));
  }

  // ============================================================
  // Assign / reassign (agents only)
  // ============================================================
  srv.on("Assign", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (!OPEN_STATUSES.includes(ticket.status)) {
      req.reject(400, `Cannot assign a ticket in status "${ticket.status}".`);
    }

    const agentId = req.data.agent_ID;
    const agent = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: agentId }),
    );
    if (!agent) req.reject(400, "The assigned agent does not exist.");

    // Idempotent retry: same agent again changes nothing.
    if (ticket.assignee_ID && String(ticket.assignee_ID) === String(agentId)) {
      return `Ticket ${ticket.ticketCode} is already assigned to this agent. No duplicate action taken.`;
    }

    const wasAssigned = !!ticket.assignee_ID;
    const newStatus = "Assigned";
    await setTicket(tx, ticket.ID, {
      status: newStatus,
      assignee_ID: agentId,
      assignedOn: now(),
    });

    await appendEvent(tx, req, ticket, {
      eventType: wasAssigned ? "Reassigned" : "Assigned",
      fromStatus: ticket.status,
      toStatus: newStatus,
      fromAssignee: ticket.assignee_ID,
      toAssignee: agentId,
    });

    await persistAudit(req, wasAssigned ? "Reassign" : "Assign", "HRTicket",
      { status: ticket.status, assignee: ticket.assignee_ID },
      { status: newStatus, assignee: agentId });

    // Both participants hear about it - the agent who now owns
    // the work and the requester who is waiting.
    await notify(tx, {
      recipientId: agentId,
      title: `Support request ${ticket.ticketCode} assigned to you`,
      message: `A ${ticket.category} request (priority ${ticket.priority}) was assigned to you.`,
      category: "SUPPORT",
      priority: ticket.priority,
      sourceModule: "Helpdesk",
      sourceEntity: "HRTicket",
      sourceRecordId: ticket.ID,
    });
    await notify(tx, {
      recipientId: ticket.requester_ID,
      title: `Your support request ${ticket.ticketCode} is being handled`,
      message: `Your request was assigned to an HR support agent.`,
      category: "SUPPORT",
      sourceModule: "Helpdesk",
      sourceEntity: "HRTicket",
      sourceRecordId: ticket.ID,
    });

    return `Ticket ${ticket.ticketCode} assigned (event recorded).`;
  });

  // ============================================================
  // Working states (agents only, assignee re-checked)
  // ============================================================
  srv.on("Start", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (ticket.status !== "Assigned") {
      req.reject(400, `Start is only allowed from "Assigned" (this one is "${ticket.status}").`);
    }
    // The assignee (if set) is expected to open the work; HR
    // with no assignee relationship may also start (grant level).
    const me = ownEmployeeId(req);
    if (me && ticket.assignee_ID && String(me) !== String(ticket.assignee_ID)) {
      req.reject(403, "Only the assigned agent may start this ticket.");
    }

    await setTicket(tx, ticket.ID, { status: "InProgress" });
    await appendEvent(tx, req, ticket, {
      eventType: "StatusChange",
      fromStatus: "Assigned",
      toStatus: "InProgress",
    });
    await persistAudit(req, "StartProgress", "HRTicket",
      { status: "Assigned" }, { status: "InProgress" });
    return `Ticket ${ticket.ticketCode} is now InProgress.`;
  });

  srv.on("WaitForEmployee", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (!["Assigned", "InProgress", "WaitingForEmployee"].includes(ticket.status)) {
      req.reject(400, `Cannot wait for the employee from status "${ticket.status}".`);
    }
    if (ticket.status === "WaitingForEmployee") {
      // Second call while already waiting = idempotent no-op.
      return `Ticket ${ticket.ticketCode} is already WaitingForEmployee. No duplicate action taken.`;
    }

    await setTicket(tx, ticket.ID, { status: "WaitingForEmployee" });
    await appendEvent(tx, req, ticket, {
      eventType: "StatusChange",
      reason: req.data.reason,
      fromStatus: ticket.status,
      toStatus: "WaitingForEmployee",
    });
    await persistAudit(req, "WaitForEmployee", "HRTicket",
      { status: ticket.status }, { status: "WaitingForEmployee" });

    // The requester MUST know the ball is in their court.
    await notify(tx, {
      recipientId: ticket.requester_ID,
      title: `Information needed for ${ticket.ticketCode}`,
      message: req.data.reason
        ? String(req.data.reason).slice(0, 200)
        : `Your HR support request needs your input to continue.`,
      category: "SUPPORT",
      sourceModule: "Helpdesk",
      sourceEntity: "HRTicket",
      sourceRecordId: ticket.ID,
    });
    return `Ticket ${ticket.ticketCode} is now WaitingForEmployee.`;
  });

  // ============================================================
  // Resolve (notes REQUIRED) - agents only
  // ============================================================
  srv.on("Resolve", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (!["Assigned", "InProgress", "WaitingForEmployee"].includes(ticket.status)) {
      req.reject(400, `Cannot resolve a ticket from status "${ticket.status}".`);
    }
    if (!req.data.resolutionNotes) {
      req.reject(400, "resolutionNotes are required to resolve a ticket.");
    }

    await setTicket(tx, ticket.ID, {
      status: "Resolved",
      resolutionNotes: req.data.resolutionNotes,
      resolvedOn: now(),
    });
    await appendEvent(tx, req, ticket, {
      eventType: "StatusChange",
      fromStatus: ticket.status,
      toStatus: "Resolved",
    });
    await persistAudit(req, "Resolve", "HRTicket",
      { status: ticket.status }, { status: "Resolved" });

    await notify(tx, {
      recipientId: ticket.requester_ID,
      title: `Your support request ${ticket.ticketCode} was resolved`,
      message: `Please review the resolution and close the ticket or reopen it if you disagree.`,
      category: "SUPPORT",
      sourceModule: "Helpdesk",
      sourceEntity: "HRTicket",
      sourceRecordId: ticket.ID,
    });
    return `Ticket ${ticket.ticketCode} resolved.`;
  });

  // ============================================================
  // Close (requester confirms / HR administratively)
  // ============================================================
  srv.on("Close", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (ticket.status !== "Resolved") {
      req.reject(400, `Close is only allowed from "Resolved" (this one is "${ticket.status}").`);
    }
    const me = ownEmployeeId(req);
    const isOwner = me && String(me) === String(ticket.requester_ID);
    if (!isOwner && !isHR(req)) {
      req.reject(403, "Only the requester or HR may close this ticket.");
    }

    await setTicket(tx, ticket.ID, { status: "Closed", closedOn: now() });
    await appendEvent(tx, req, ticket, {
      eventType: "StatusChange",
      fromStatus: "Resolved",
      toStatus: "Closed",
    });
    await persistAudit(req, "Close", "HRTicket",
      { status: "Resolved" }, { status: "Closed" });

    if (ticket.assignee_ID) {
      await notify(tx, {
        recipientId: ticket.assignee_ID,
        title: `Support request ${ticket.ticketCode} closed`,
        message: `The requester confirmed the resolution.`,
        category: "SUPPORT",
        sourceModule: "Helpdesk",
        sourceEntity: "HRTicket",
        sourceRecordId: ticket.ID,
      });
    }
    return `Ticket ${ticket.ticketCode} closed.`;
  });

  // ============================================================
  // Reopen - requester or HR, history fully preserved
  // ============================================================
  srv.on("Reopen", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (!["Resolved", "Closed"].includes(ticket.status)) {
      req.reject(400, `Reopen is only allowed for Resolved/Closed tickets (this one is "${ticket.status}").`);
    }
    if (!req.data.reason) req.reject(400, "A reopen reason is required.");
    const me = ownEmployeeId(req);
    const isOwner = me && String(me) === String(ticket.requester_ID);
    if (!isOwner && !isHR(req)) {
      req.reject(403, "Only the requester or HR may reopen this ticket.");
    }

    // Back to work with the SAME agent if one exists, otherwise
    // straight back to the New queue.
    const newStatus = ticket.assignee_ID ? "InProgress" : "New";
    await setTicket(tx, ticket.ID, {
      status: newStatus,
      resolutionNotes: null,
      resolvedOn: null,
      closedOn: null,
    });
    await appendEvent(tx, req, ticket, {
      eventType: "Reopened",
      reason: req.data.reason,
      fromStatus: ticket.status,
      toStatus: newStatus,
    });
    await persistAudit(req, "Reopen", "HRTicket",
      { status: ticket.status }, { status: newStatus, reason: req.data.reason });

    const recipient = ticket.assignee_ID;
    if (recipient) {
      await notify(tx, {
        recipientId: recipient,
        title: `Support request ${ticket.ticketCode} reopened`,
        message: `The ticket was reopened: ${String(req.data.reason).slice(0, 150)}`,
        category: "SUPPORT",
        priority: ticket.priority,
        sourceModule: "Helpdesk",
        sourceEntity: "HRTicket",
        sourceRecordId: ticket.ID,
      });
    }
    return `Ticket ${ticket.ticketCode} reopened (status ${newStatus}). History preserved.`;
  });

  // ============================================================
  // Priority change (HR triage; idempotent)
  // ============================================================
  srv.on("ChangePriority", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticket = await loadTicket(tx, req.params?.[0]?.ID ?? req.params?.[0]);
    if (!ticket) req.reject(404, "Ticket not found.");

    if (!OPEN_STATUSES.includes(ticket.status)) {
      req.reject(400, `Cannot change priority of a ticket in status "${ticket.status}".`);
    }
    if (!PRIORITIES.includes(req.data.priority)) {
      req.reject(400, `Priority must be one of: ${PRIORITIES.join(", ")}.`);
    }
    if (req.data.priority === ticket.priority) {
      return `Priority is already ${ticket.priority}. No duplicate event.`;
    }

    const old = ticket.priority;
    await setTicket(tx, ticket.ID, { priority: req.data.priority });
    await appendEvent(tx, req, ticket, { eventType: "PriorityChanged" });
    await persistAudit(req, "ChangePriority", "HRTicket",
      { priority: old }, { priority: req.data.priority });
    return `Ticket ${ticket.ticketCode} priority changed ${old} -> ${req.data.priority}.`;
  });
};
