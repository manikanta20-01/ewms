// ============================================================
// SPRINT 10 - BUSINESS CALLBACK REGISTRY
// ------------------------------------------------------------
// The workflow engine must stay GENERIC: it cannot know that
// "leave approved" means "deduct balance", or that "payroll
// approved" means "generate payslips". Those reactions belong to
// the owning business module.
//
// Contract: a business module registers itself ONCE per business
// object type (entity name) and may implement any subset of:
//
//   applyDecision(tx, instance, decision, comments)
//       Called when the instance reaches a FINAL status
//       ('Approved', 'Rejected', 'Cancelled', 'Terminated').
//       'Rework' is NOT final - see applyRework below.
//
//   applyRework(tx, instance, comments)
//       Called when a task is sent back to the requester
//       (status 'Rework'). Module returns the object to its
//       editable/submittable state.
//
//   applyResubmit(tx, instance)
//       Called when the requester resubmits after Rework
//       (engine restarts step 1 automatically).
//
//   getTitle(tx, instance)
//       Optional short human-readable title of the business
//       object for history messages (defaults to the ID).
//
// All callbacks run INSIDE the same transaction as the workflow
// action, so module state and workflow state stay consistent.
//
// Leave registers itself in srv/leave/leave-callbacks.js.
// Future modules (Payroll, Timesheet, ...) register the same way:
//   const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");
//   registerCallbacks("ewms.db.payroll.PayrollProcess", { applyDecision: ... });
// ============================================================

const callbacksByObjectType = {};

/**
 * Register callbacks for one business object type.
 * Later registration for the same type replaces the earlier one
 * (useful for tests).
 */
function registerCallbacks(businessObjectType, callbacks) {
  callbacksByObjectType[businessObjectType] = callbacks || {};
}

/** Get registered callbacks (or an empty object). */
function getCallbacks(businessObjectType) {
  return callbacksByObjectType[businessObjectType] || {};
}

module.exports = { registerCallbacks, getCallbacks };
