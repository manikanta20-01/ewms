const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");
const { persistAudit } = require("../../common/utils/audit");
const {
  COMMENT_ENTITY,
  TICKET_ENTITY,
  EVENT_ENTITY,
  INTERNAL_KINDS,
  isHR,
  ownEmployeeId,
  latestDepartmentId,
  notifyDepartmentHR,
} = require("./helpdesk-common");

// ============================================================
// SPRINT 20 - COMMENTS / CONVERSATION HANDLERS
// ------------------------------------------------------------
// Beginner summary of the rules implemented here:
//
//   * Comments ONLY enter the system through the AddComment
//     action (direct CREATE refused) and are IMMUTABLE after
//     that (no UPDATE/DELETE for anyone) - the conversation is
//     the ticket's evidence trail.
//
//   * Kind rules:
//       - Agents (HR trio): may write InternalNote (private
//         working notes) and AgentResponse (the official reply).
//       - Employees: may ONLY write EmployeeResponse, and only
//         on their OWN ticket.
//
//   * InternalNote rows are FILTERED OUT of every requester read
//     server-side - never a UI hide.
//
//   * Agent's first AgentResponse stamps firstResponseAt (the
//     actual-response-time measurement input; nothing automatic
//     is claimed on top of it).
//
//   * The automatic rule: WaitingForEmployee + EmployeeResponse
//     puts the ticket back to InProgress (the requester answered)
//     and the assignee (or the department's HR reps) is notified.
// ============================================================

module.exports = (srv) => {
  const { HRTickets, HRTicketComments } = srv.entities;

  const now = () => new Date().toISOString();

  // Records only enter through AddComment; immutable afterwards.
  srv.before("CREATE", HRTicketComments, (req) => {
    req.reject(400, "Comments are added through the AddComment action only.");
  });
  srv.before(["UPDATE", "DELETE"], HRTicketComments, (req) => {
    req.reject(403, "Comments are immutable evidence.");
  });

  // ----------------------------------------------------------
  // AddComment (bound action on HRTickets)
  // ----------------------------------------------------------
  srv.on("AddComment", HRTickets, async (req) => {
    const tx = cds.transaction(req);
    const ticketId = req.params?.[0]?.ID ?? req.params?.[0];
    const ticket = await tx.run(SELECT.one.from(TICKET_ENTITY).where({ ID: ticketId }));
    if (!ticket) req.reject(404, "Ticket not found.");

    const me = ownEmployeeId(req);
    if (!me) req.reject(403, "Your user is not linked to an employee record.");

    const kind = req.data.kind || (isHR(req) ? "AgentResponse" : "EmployeeResponse");
    if (!req.data.text) req.reject(400, "Comment text is required.");

    const isOwner = String(me) === String(ticket.requester_ID);

    if (kind === "EmployeeResponse") {
      // ONLY the requester speaks for themselves.
      if (!isOwner) {
        req.reject(403, "Only the requester can add an employee response on their own ticket.");
      }
    } else if (kind === "InternalNote" || kind === "AgentResponse") {
      if (!isHR(req)) {
        req.reject(403, "Only HR support agents may write agent responses or internal notes.");
      }
    } else {
      req.reject(400, `Unknown comment kind "${kind}".`);
    }

    if (kind === "InternalNote" && isOwner && isHR(req)) {
      // An HR person answering their OWN ticket still writes a
      // normal response, not a note only they could see.
      req.reject(400, "Internal notes on your own ticket make no sense; use AgentResponse.");
    }

    const commentId = cds.utils.uuid();
    await tx.run(
      INSERT.into(COMMENT_ENTITY).entries({
        ID: commentId,
        ticket_ID: ticket.ID,
        author_ID: me,
        kind,
        text: String(req.data.text).slice(0, 2000),
      }),
    );

    const updates = {};

    // First agent resp
    if (kind === "AgentResponse" && !ticket.firstResponseAt) {
      updates.firstResponseAt = now();
    }

    // The automatic rule: the requester answered -> back to work.
    if (kind === "EmployeeResponse" && ticket.status === "WaitingForEmployee") {
      updates.status = "InProgress";
    }

    if (Object.keys(updates).length > 0) {
      await tx.run(UPDATE(TICKET_ENTITY, ticket.ID).set(updates));
      if (updates.status) {
        await tx.run(
          INSERT.into(EVENT_ENTITY).entries({
            ID: cds.utils.uuid(),
            ticket_ID: ticket.ID,
            eventType: "StatusChange",
            actor_ID: me,
            fromStatus: "WaitingForEmployee",
            toStatus: "InProgress",
          }),
        );
        await persistAudit(req, "EmployeeResponse", "HRTicket",
          { status: "WaitingForEmployee" }, { status: "InProgress" });
      }
    }

    // Notify the counterpart, without the sensitive ticket text.
    if (kind === "AgentResponse" && !isOwner) {
      await notify(tx, {
        recipientId: ticket.requester_ID,
        title: `New reply on your support request ${ticket.ticketCode}`,
        message: `The HR support team replied to your request.`,
        category: "SUPPORT",
        sourceModule: "Helpdesk",
        sourceEntity: "HRTicket",
        sourceRecordId: ticket.ID,
      });
    } else if (kind === "EmployeeResponse") {
      await notify(tx, {
        recipientId: ticket.assignee_ID,
        title: `Reply received on ${ticket.ticketCode}`,
        message: `The requester responded; the ticket is back InProgress.`,
        category: "SUPPORT",
        sourceModule: "Helpdesk",
        sourceEntity: "HRTicket",
        sourceRecordId: ticket.ID,
      });
      // No assignee yet -> the department's HR reps hear it.
      if (!ticket.assignee_ID) {
        const dept = ticket.requesterDepartment_ID ??
          (await latestDepartmentId(tx, ticket.requester_ID));
        await notifyDepartmentHR(
          tx,
          dept,
          {
            title: `Requester answered ${ticket.ticketCode}`,
            message: `Waiting-request received an employee response; please pick it up.`,
            category: "SUPPORT",
            sourceModule: "Helpdesk",
            sourceEntity: "HRTicket",
            sourceRecordId: ticket.ID,
          },
          now().slice(0, 10),
        );
      }
    }
    // InternalNote: no notification by definition (private).

    return `Comment added (kind ${kind}${updates.status ? ", ticket back InProgress" : ""}).`;
  });

  // ----------------------------------------------------------
  // READ filtering (privacy): requesters never see InternalNote
  // rows and never see comments of tickets that are not theirs.
  // ----------------------------------------------------------
  srv.after("READ", HRTicketComments, async (rows, req) => {
    if (!rows || rows.length === 0 || isHR(req)) return rows;
    const me = ownEmployeeId(req);
    if (!me) {
      rows.splice(0, rows.length);
      return rows;
    }
    const tx = cds.transaction(req);
    const ownTickets = await tx.run(
      SELECT.from(TICKET_ENTITY)
        .columns("ID")
        .where({ requester_ID: me }),
    );
    const own = new Set(ownTickets.map((t) => String(t.ID)));
    // CAP after-READ hooks only take effect through IN-PLACE
    // modification of the result array - a returned new array
    // would be ignored.
    const kept = rows.filter(
      (r) => own.has(String(r.ticket_ID)) && !INTERNAL_KINDS.includes(r.kind),
    );
    rows.splice(0, rows.length, ...kept);
    return rows;
  });
};
