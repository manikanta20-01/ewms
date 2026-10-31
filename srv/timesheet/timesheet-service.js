const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 15 - TIMESHEET SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Wires the shared cross-cutting services plus the module handlers.
// No duplicate audit/notification/workflow/authorization
// infrastructure is introduced:
//
//   * registerAuditHooks -> the shared Sprint 9 audit util records
//     every direct CREATE/UPDATE/DELETE on the exposed entities.
//   * handlers/timesheet-validation  -> CRUD-level business guards.
//   * handlers/timesheet-lifecycle   -> bound lifecycle actions
//     (Submit/StartReview/Approve/Reject/Withdraw/Cancel/Reopen),
//     notification via the shared notification core, history via
//     an append-only ledger, audit via the shared utility.
//   * timesheet-workflow             -> optional generic workflow
//     engine (Sprint 10) integration via StartWorkflow + callbacks.
//   * handlers/timesheet-payroll     -> consumption module called
//     FROM the payroll engine (see that file; the engine imports it).
// ============================================================

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Timesheets", "TimesheetItems"],
  });

  require("./handlers/timesheet-validation")(this);
  require("./handlers/timesheet-lifecycle")(this);
  require("./handlers/timesheet-workflow")(this);
});
