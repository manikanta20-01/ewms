const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { hasRole } = require("../../common/auth/authorization");

// ============================================================
// SUPPORTED
// ============================================================

const TICKET_ENTITY = "ewms.db.helpdesk.HRTicket";
const COMMENT_ENTITY = "ewms.db.helpdesk.HRTicketComment";
const EVENT_ENTITY = "ewms.db.helpdesk.HRTicketEvent";
const SLA_ENTITY = "ewms.db.helpdesk.HRTicketCategorySLA";
const DEPT_HR_ENTITY = "ewms.db.organization.DepartmentHR";

/** Comment kinds that stay OUT of requester reads. */
const INTERNAL_KINDS = ["InternalNote"];

/** HR trio - the support agents of this module. */
function isHR(req) {
  return hasRole(req, "HRExecutive", "HRAdmin", "SystemAdmin");
}

/** $user.employeeId or null for non-employee-linked users. */
function ownEmployeeId(req) {
  return req.user?.attr?.employeeId ?? req.user?.employeeId ?? null;
}

/** Valid priorities (enums.HRTicketPriority mirror). */
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

/** The open states (everything before Resolved/Closed). */
const OPEN_STATUSES = ["New", "Assigned", "InProgress", "WaitingForEmployee"];

/**
 * Helpers for the helpdesk module - small building blocks shared
 * by the three handler files. Kept separate from business rules
 * so the files stay focused (same convention as the policy
 * module's handlers/policy-common.js).
 */
module.exports = {
  TICKET_ENTITY,
  COMMENT_ENTITY,
  EVENT_ENTITY,
  SLA_ENTITY,
  INTERNAL_KINDS,
  OPEN_STATUSES,
  PRIORITIES,
  isHR,
  ownEmployeeId,
  departmentHRRecipients,
  notifyDepartmentHR,

  /**
   * The newest EmployeeHistory row of an employee (raw EmployeeID:
   * same chain as the policy module resolves its applicability -
   * Employee -> latest EmployeeHistory -> Department).
   */
  async latestDepartmentId(tx, employeeId) {
    if (!employeeId) return null;
    const hist = await tx.run(
      SELECT.one
        .from("ewms.db.employee.EmployeeHistory")
        .where({ employee_ID: employeeId })
        .orderBy({ effectiveDate: "desc" }),
    );
    return hist?.department_ID ?? null;
  },

};

/**
 * Recipients = the ACTIVE HR representatives registered for a
 * department (Sprint 2 DepartmentHR configuration). No
 * configuration -> no recipient -> notification skipped
 * (documented: nothing is invented).
 */
async function departmentHRRecipients(tx, departmentId, today) {
  if (!departmentId) return [];
  const rows = await tx.run(
    SELECT.from(DEPT_HR_ENTITY).where({ department_ID: departmentId }),
  );
  // Active representation only, and only when `today` falls
  // inside the (optional) from/to window of the assignment.
  return (rows || [])
    .filter(
      (r) =>
        r.isActive &&
        (!r.fromDate || today >= r.fromDate) &&
        (!r.toDate || today <= r.toDate),
    )
    .map((r) => r.employee_ID);
}

/**
 * Notify the department's HR representatives about a new ticket
 * or an unanswered follow-up - no recipient configured = nobody
 * is notified (no invented fallback).
 */
async function notifyDepartmentHR(tx, departmentId, payload, today) {
  const { notify } = require("../../notification/handlers/notification-core");
  const recipients = await departmentHRRecipients(tx, departmentId, today);
  for (const recipientId of recipients) {
    await notify(tx, { ...payload, recipientId });
  }
  return recipients.length;
}
