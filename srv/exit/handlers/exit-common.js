const cds = require("@sap/cds");
const { SELECT, INSERT } = cds.ql;
const { hasGroup } = require("../../common/auth/authorization");

// ============================================================
// SPRINT 21 - EXIT COMMON HELPERS
// ------------------------------------------------------------
// Small shared pieces used by every exit handler: the status
// machine, actor/role checks, the event writer and the sensitive
// reader mask. Kept in ONE place so no module-private rule ever
// drifts between handlers.
// ============================================================

const CASE_DB = "ewms.db.exit.ExitCase";
const ITEM_DB = "ewms.db.exit.ExitChecklistItem";
const EVENT_DB = "ewms.db.exit.ExitEvent";

// ------------------------------------------------------------
// THE EXIT LIFECYCLE (commented truth table)
// ------------------------------------------------------------
// The main chain Draft -> ... -> Completed is in the enum docs.
// Additional named transitions:
//   SubmitEntry   : statuses a Submit action may start FROM
//   WithdrawEntry : statuses the Withdraw action may stop
//   workflowDecision : where a workflow decision may land the
//     case (Submitted OR InReview - the engine runs while the
//     case waits in either state)
// Reported as transition arrays so user-facing errors can quote
// the actual allowed list.
// ------------------------------------------------------------
const TRANSITIONS = {
  Draft: ["Submitted", "Withdrawn"],
  Submitted: ["InReview", "Approved", "Rejected", "Withdrawn"],
  InReview: ["Approved", "Rejected", "Withdrawn"],
  Approved: ["ClearanceInProgress"],
  ClearanceInProgress: ["ReadyForSeparation"],
  ReadyForSeparation: ["Completed"],
  Rejected: ["Draft"], // Reconsider
  Withdrawn: [],       // final
  Cancelled: [],       // final
  Completed: [],       // final (corrections only via Correct action)
};

const SUBMIT_FROM = ["Draft"];
const WITHDRAW_FROM = ["Draft", "Submitted", "InReview"];
const WORKFLOW_DECISION_FROM = ["Submitted", "InReview"];

function assertTransition(req, from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Exit case cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/** Raw-UUID-safe key extraction (CAP 8 bound actions - see other
 *  modules' keysOf; a raw string in .where() makes CQN parse the
 *  UUID as an expression). */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

/** Caller's employee ID (mocked auth bridges attr.employeeId). */
function actorId(req) {
  return req.user?.attr?.employeeId ?? req.user?.employeeId ?? null;
}

/** Is the caller one of the HR trio (the module's HR actors)? */
function isHR(req) {
  return hasGroup(req, "HR");
}

/**
 * APPEND-ONLY event row. Every business-visible transition calls
 * this once. The companion workflow approval history lives in the
 * engine's WorkflowHistory; this is the exit-side story.
 */
async function recordEvent(tx, { caseId, eventType, actor, reason, details, fromStatus, toStatus }) {
  await tx.run(
    INSERT.into(EVENT_DB).entries({
      ID: cds.utils.uuid(),
      exitCase_ID: caseId,
      eventType,
      actor_ID: actor || null,
      reason: reason || null,
      details: details || null,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      eventOn: new Date().toISOString(),
    }),
  );
}

/**
 * One active exit case per employee: refuses a NEW case while the
 * employee still has one in an open status. Safe retries of the
 * SAME create use clientRequestId instead (checked in create).
 */
async function hasOpenCase(tx, employeeId) {
  const open = await tx.run(
    SELECT.one.from(CASE_DB).where({
      employee_ID: employeeId,
      status: {
        in: ["Draft", "Submitted", "InReview", "Approved", "ClearanceInProgress", "ReadyForSeparation"],
      },
    }),
  );
  return !!open;
}

/**
 * All mandatory checklist items of the case complete? Returns the
 * list of still-open mandatory itemCodes (empty = clear) - the
 * same list is used for the MarkReadyForSeparation guard and the
 * late guard inside CompleteExit (paranoia: clearance is checked
 * again where the consequences are set in stone).
 */
async function openMandatoryItems(tx, caseId) {
  const items = await tx.run(
    SELECT.from(ITEM_DB).where({
      exitCase_ID: caseId,
      mandatory: true,
      status: { in: ["Pending", "NotApplicable"] },
    }),
  );
  return items;
}

/** The case employee's ACTIVE assignment (for manager checks). */
async function activeAssignmentOf(tx, employeeId) {
  return tx.run(
    SELECT.one.from("ewms.db.employee.EmployeeAssignment").where({
      employee_ID: employeeId,
      isActive: true,
    }),
  );
}

/** Tenant-class read masks (employer-initiated reason privacy). */
async function maskReasonsForNonHR(rows, req) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  if (isHR(req)) return;
  for (const row of rows) {
    if (row?.exitType === "EmployerInitiated") {
      // Sensitive employer-initiated details never reach a
      // non-HR reader: the reasons are withheld server-side.
      row.reasonText = "(restricted to HR)";
      row.reasonCategory = "Other";
    }
  }
}

module.exports = {
  CASE_DB,
  ITEM_DB,
  EVENT_DB,
  TRANSITIONS,
  SUBMIT_FROM,
  WITHDRAW_FROM,
  WORKFLOW_DECISION_FROM,
  assertTransition,
  keysOf,
  actorId,
  isHR,
  recordEvent,
  hasOpenCase,
  openMandatoryItems,
  activeAssignmentOf,
  maskReasonsForNonHR,
};
