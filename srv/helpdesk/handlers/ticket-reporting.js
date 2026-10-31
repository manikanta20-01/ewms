const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const {
  TICKET_ENTITY,
  SLA_ENTITY,
  OPEN_STATUSES,
  isHR,
} = require("./helpdesk-common");

// ============================================================
// SPRINT 20 - OVERDUE / SLA REPORTING (COMPUTED)
// ------------------------------------------------------------
// Beginner summary:
//
//   * Everything here is COMPUTED AT READ TIME - there is no
//     stored "overdue" flag that could go stale.
//
//   * Targets come from the CONFIGURABLE HRTicketCategorySLA
//     rows (nullable by design). A category without a target
//     can never be overdue on that axis - no hardcoded SLA
//     values anywhere.
//
//   * 'Response' overdue  = still no AgentResponse in the
//     ticket (firstResponseAt is null) past the response target.
//     'Resolution' overdue = the open ticket is past its
//     resolution target.
//
//   * Escalation READINESS only: the hoursOverdue column is the
//     natural escalation criterion for a FUTURE background job.
//     The repo has no scheduler, so no automatic escalation is
//     claimed anywhere.
// ============================================================

module.exports = (srv) => {
  const { OverdueTickets } = srv.entities;

  srv.on("READ", OverdueTickets, async (req) => {
    if (!isHR(req)) {
      req.reject(403, "Overdue ticket reporting is HR-only.");
    }

    const tx = cds.transaction(req);
    const nowMs = Date.now();

    const [tickets, slas] = await Promise.all([
      tx.run(SELECT.from(TICKET_ENTITY)),
      tx.run(SELECT.from(SLA_ENTITY)),
    ]);

    // One configurable row per category; inactive rows ignored.
    const slaByCategory = new Map(
      (slas || []).filter((s) => s.active !== false).map((s) => [s.category, s]),
    );

    const filters = simpleFilterValues(req);
    const rows = [];

    for (const ticket of tickets || []) {
      // Only OPEN tickets can be overdue.
      if (!OPEN_STATUSES.includes(ticket.status)) continue;

      const sla = slaByCategory.get(ticket.category);
      if (!sla) continue; // no configured target -> never overdue

      if (filters.category && ticket.category !== filters.category) continue;
      if (filters.requester_ID &&
          String(ticket.requester_ID) !== String(filters.requester_ID)) {
        continue;
      }

      const createdMs = Date.parse(ticket.createdAt);
      if (Number.isNaN(createdMs)) continue;

      const hourMs = 3600 * 1000;

      // Response target: agent has not yet answered at all.
      if (sla.responseTargetHours != null) {
        if (!ticket.firstResponseAt) {
          const dueMs = createdMs + sla.responseTargetHours * hourMs;
          if (nowMs > dueMs) {
            rows.push(row(ticket, sla.responseTargetHours, "Response", nowMs, dueMs));
          }
        }
      }

      // Resolution target: any open state is "not resolved yet".
      if (sla.resolutionTargetHours != null) {
        const dueMs = createdMs + sla.resolutionTargetHours * hourMs;
        if (nowMs > dueMs) {
          rows.push(row(ticket, sla.resolutionTargetHours, "Resolution", nowMs, dueMs));
        }
      }
    }

    return rows.sort((a, b) => b.hoursOverdue - a.hoursOverdue);
  });
};

function row(ticket, targetHours, overdueType, nowMs, dueMs) {
  return {
    ticket_ID: ticket.ID,
    ticketCode: ticket.ticketCode,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    requester_ID: ticket.requester_ID,
    assignee_ID: ticket.assignee_ID ?? null,
    createdAt: ticket.createdAt,
    targetHours,
    overdueType,
    hoursOverdue: Math.floor((nowMs - dueMs) / (3600 * 1000)),
  };
}

/** Honors the same simple-filter convention as Sprints 17/19. */
function simpleFilterValues(req) {
  const where = req.query?.SELECT?.where || [];
  const out = {};
  for (let i = 0; i < where.length - 2; i += 1) {
    const ref = where[i]?.ref;
    const val = where[i + 2]?.val;
    if (ref && val != null) out[ref[ref.length - 1]] = val;
  }
  return out;
}
