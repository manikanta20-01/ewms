const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 20 - HELPDESK SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reuses the shared audit helper (generic CRUD audit for the
// four entities plus explicit persistAudit calls in every
// lifecycle action) and the shared notify() core. Handler logic
// stays in three small focused files, mirroring the HR policy
// module.
// ============================================================
module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    // Ticket/comment text is workforce communication, not
    // compensation/secret data - safe to audit in full.
    include: ["HRTickets", "HRTicketComments", "HRTicketEvents", "HRTicketSLAConfigs"],
  });

  require("./handlers/ticket-lifecycle")(this);
  require("./handlers/ticket-comments")(this);
  require("./handlers/ticket-reporting")(this);
});
