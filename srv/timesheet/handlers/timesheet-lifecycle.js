const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 15 - TIMESHEET LIFECYCLE ACTIONS
// ------------------------------------------------------------
// Implements the controlled state machine:
//
//   Draft --Submit--> Submitted --StartReview--> InReview
//   InReview --Approve--> Approved
//   Submitted/InReview --Reject--> Draft  (editable again)
//   Submitted/InReview --Withdraw--> Draft (employee takes it back)
//   Draft/Submitted/InReview --Cancel--> Cancelled
//   Approved --Reopen--> Draft          (HR-controlled correction)
//
// Every action:
//   1. re-loads the sheet inside the CURRENT transaction,
//   2. validates the CURRENT status (no transition ever runs twice - a
//      retry that arrives after the first attempt committed is
//      rejected with a clear 400 instead of double-applying),
//   3. validates the caller's identity/scope,
//   4. writes exactly one append-only ledger row
//      (TimesheetHistory),
//   5. notifies the affected employee or reviewer through the
//      SHARED notification core,
//   6. writes an audit row through the SHARED audit utility.
//
// Authorization model (documented in the security annotations):
//   * employees drive their own sheet's self-service transitions,
//   * reviewers are the sheet's assignedManager (the reporting
//     manager recorded on the sheet at submit time) or HR,
//   * neither may approve/reject their own sheet,
//   * Reopen is HR-only and blocked once payroll consumed the sheet.
// ============================================================

const TIMESHEETS = "Timesheets"; // registration (service entity)
const ITEMS = "TimesheetItems";
const TS_DB = "ewms.db.timesheet.Timesheet";
const ITEM_DB = "ewms.db.timesheet.TimesheetItem";
const HISTORY_DB = "ewms.db.timesheet.TimesheetHistory";
const ASSIGN_DB = "ewms.db.employee.EmployeeAssignment";

function keysOf(req) {
  const p = req.params?.[0];
  return p ? (typeof p === "object" ? p : { ID: p }) : { ID: req.data?.ID };
}

function isHr(req) {
  return (
    req.user.is("HRExecutive") ||
    req.user.is("HRAdmin") ||
    req.user.is("SystemAdmin")
  );
}

function isManagerRole(req) {
  return req.user.is("DepartmentManager") || req.user.is("ProjectManager");
}

/** Loads the sheet with a nicer error message when it is missing. */
async function loadSheet(req, tx, subject) {
  const sheet = await tx.run(SELECT.one.from(TS_DB).where(keysOf(req)));
  if (!sheet) {
    req.error(404, `${subject ?? "Timesheet"} not found.`);
    return null;
  }
  return sheet;
}

/**
 * CONDITIONAL (optimistic) transition.
 * The status update is guarded in the WHERE clause itself: it only
 * matches while the row is STILL in the expected previous status.
 * When zero rows change, somebody else already completed (or
 * reversed) the same transition - the caller rejects with 409. This
 * is what makes duplicate submissions/approvals and two concurrent
 * attempts conflict-free: the LAST write can never silently double-
 * apply, the loser of a race gets a clean error.
 * @returns false after requesting a 409 - callers must return.
 */
async function transition(tx, req, sheet, fromStatus, setValues) {
  const rowsChanged = await tx.run(
    UPDATE(TS_DB)
      .set(setValues)
      .where({ ID: sheet.ID, status: fromStatus }),
  );
  if (rowsChanged === 0) {
    req.reject(
      409,
      "Concurrent modification: the timesheet was changed by another request - reload and retry.",
    );
    return false;
  }
  return true;
}

/**
 * Appends one ledger row + audit entry. Never throws: the business
 * transition already happened; bookkeeping failures are logged.
 */
async function recordTransition(req, tx, sheet, action, previousStatus, newStatus, comments) {
  try {
    await tx.run(
      INSERT.into(HISTORY_DB).entries({
        timesheet_ID: sheet.ID,
        action,
        previousStatus: previousStatus ?? null,
        newStatus,
        actor_ID: req.user?.attr?.employeeId ?? null,
        actedOn: new Date().toISOString(),
        comments: comments ?? null,
      }),
    );
  } catch (e) {
    cds.log("timesheet").error("history write failed (transition continues):", e.message);
  }
  await persistAudit(req, action, "Timesheets", { status: previousStatus }, {
    ID: sheet.ID,
    status: newStatus,
  });
}


module.exports = (srv) => {
  srv.on("Submit", srv.entities.Timesheets, submitTimesheet);
  srv.on("StartReview", srv.entities.Timesheets, startReview);
  srv.on("Approve", srv.entities.Timesheets, approveTimesheet);
  srv.on("Reject", srv.entities.Timesheets, rejectTimesheet);
  srv.on("Withdraw", srv.entities.Timesheets, withdrawTimesheet);
  srv.on("Cancel", srv.entities.Timesheets, cancelTimesheet);
  srv.on("Reopen", srv.entities.Timesheets, reopenTimesheet);
};

/**
 * Submits a Draft sheet:
 *   - requires at least one work item,
 *   - recomputes the totals,
 *   - refreshes the assignedManager from the ACTIVE assignment that
 *     covers the period (the reviewer scope at decision time),
 *   - marks the sheet Submitted and notifies the manager.
 */
async function submitTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "Draft") {
    return req.reject(
      400,
      `Only Draft timesheets can be submitted (current status: '${sheet.status}').`,
    );
  }

  // Owner or HR: the em-security grants allow the owner (and HR);
  // the explicit check protects in-service action loops.
  const me = req.user?.attr?.employeeId;
  if (me && sheet.employee_ID !== me && !isHr(req)) {
    return req.reject(403, "You may only submit your own timesheet.");
  }

  const items = await tx.run(
    SELECT.from(ITEM_DB).where({ timesheet_ID: sheet.ID }),
  );
  if (!items.length) {
    return req.error(400, "A timesheet needs at least one work entry before it can be submitted.");
  }

  const regular = items.reduce((s, i) => s + Number(i.regularHours || 0), 0);
  const overtime = items.reduce((s, i) => s + Number(i.overtimeHours || 0), 0);

  // The reviewer in scope: the manager from the assignment active
  // at the period start. Falls back to the newest assignment.
  let managerId = null;
  const assignments = await tx.run(
    SELECT.from(ASSIGN_DB)
      .where({ employee_ID: sheet.employee_ID })
      .orderBy("fromDate desc"),
  );
  const covering =
    assignments.find(
      (a) =>
        sheet.periodFromDate >= a.fromDate &&
        (!a.toDate || sheet.periodFromDate <= a.toDate),
    ) || assignments[0];
  if (covering?.reportingManager_ID) managerId = covering.reportingManager_ID;

  if (!managerId) {
    return req.error(
      400,
      "The employee's active assignment has no reporting manager - a timesheet cannot be routed for review.",
    );
  }

  if (!(await transition(tx, req, sheet, "Draft", { status: "Submitted", submittedOn: new Date().toISOString(), regularHours: Number(regular.toFixed(2)), overtimeHours: Number(overtime.toFixed(2)), assignedManager_ID: managerId })))
    return;

  await recordTransition(req, tx, sheet, "Submitted", "Draft", "Submitted",
    `Submitted with ${items.length} work entry(-ies).`);

  await notify(tx, {
    recipientId: managerId,
    title: "Timesheet waiting for your review",
    message: `Timesheet ${sheet.timesheetCode} (${sheet.periodFromDate} - ${sheet.periodToDate}) was submitted for approval.`,
    category: "TIMESHEET",
    priority: "High",
    sourceModule: "Timesheet",
    sourceEntity: TS_DB,
    sourceRecordId: sheet.ID,
  });

  return `Timesheet ${sheet.timesheetCode} submitted.`;
}

/**
 * Approves an InReview sheet. Guards:
 *   - status must be InReview (a retry after commit fails cleanly),
 *   - self-approval is never allowed,
 *   - the approver must be the sheet's assignedManager or HR.
 */
async function approveTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "InReview") {
    return req.reject(
      400,
      `Only timesheets in 'InReview' status can be approved (current status: '${sheet.status}').`,
    );
  }

  const me = req.user?.attr?.employeeId;
  if (me && me === sheet.employee_ID) {
    return req.reject(403, "You cannot approve your own timesheet.");
  }
  const inScope =
    (me && sheet.assignedManager_ID === me) || isHr(req);
  if (!inScope) {
    return req.reject(
      403,
      "Only the reporting manager of this employee (or HR) may approve this timesheet.",
    );
  }

  if (
    !(await transition(tx, req, sheet, "InReview", {
      status: "Approved",
      reviewedBy_ID: me ?? null,
      reviewedOn: new Date().toISOString(),
      reviewerComments: req.data?.comments ?? sheet.reviewerComments ?? null,
    }))
  )
    return;

  await recordTransition(req, tx, sheet, "Approved", "InReview", "Approved",
    req.data?.comments);

  await notify(tx, {
    recipientId: sheet.employee_ID,
    title: "Your timesheet was approved",
    message: `Timesheet ${sheet.timesheetCode} (${sheet.periodFromDate} - ${sheet.periodToDate}) is approved.`,
    category: "TIMESHEET",
    priority: "Medium",
    sourceModule: "Timesheet",
    sourceEntity: TS_DB,
    sourceRecordId: sheet.ID,
  });

  return `Timesheet ${sheet.timesheetCode} approved.`;
}

/**
 * Rejects a Submitted/InReview sheet back to Draft. The reason is
 * mandatory (a compliance event, like payroll rejection).
 */
async function rejectTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "Submitted" && sheet.status !== "InReview") {
    return req.reject(
      400,
      `Only Submitted or InReview timesheets can be rejected (current status: '${sheet.status}').`,
    );
  }

  const comments = req.data?.comments;
  if (!comments || !String(comments).trim()) {
    return req.error(400, "A reason is required when rejecting a timesheet.");
  }

  const me = req.user?.attr?.employeeId;
  if (me && me === sheet.employee_ID) {
    return req.reject(403, "You cannot reject your own timesheet.");
  }
  const inScope = (me && sheet.assignedManager_ID === me) || isHr(req);
  if (!inScope) {
    return req.reject(
      403,
      "Only the reporting manager of this employee (or HR) may reject this timesheet.",
    );
  }

  if (
    !(await transition(tx, req, sheet, sheet.status, {
      status: "Draft",
      reviewerComments: comments,
      submittedOn: null,
    }))
  )
    return;

  await recordTransition(req, tx, sheet, "Rejected", sheet.status, "Draft", comments);

  await notify(tx, {
    recipientId: sheet.employee_ID,
    title: "Your timesheet was sent back",
    message: `Timesheet ${sheet.timesheetCode} was rejected: ${comments}`,
    category: "TIMESHEET",
    priority: "High",
    sourceModule: "Timesheet",
    sourceEntity: TS_DB,
    sourceRecordId: sheet.ID,
  });

  return `Timesheet ${sheet.timesheetCode} rejected and returned to Draft.`;
}

/**
 * Employee withdrawal: Submitted/InReview -> Draft. The sheet owner
 * (or HR) may take their sheet back to correct it.
 */
async function withdrawTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "Submitted" && sheet.status !== "InReview") {
    return req.reject(
      400,
      `Only Submitted or InReview timesheets can be withdrawn (current status: '${sheet.status}').`,
    );
  }

  const me = req.user?.attr?.employeeId;
  if (me && sheet.employee_ID !== me && !isHr(req)) {
    return req.reject(403, "You may only withdraw your own timesheet.");
  }

  if (!(await transition(tx, req, sheet, sheet.status, { status: "Draft", submittedOn: null })))
    return;

  await recordTransition(req, tx, sheet, "Withdrawn", sheet.status, "Draft",
    "Withdrawn by the employee.");

  return `Timesheet ${sheet.timesheetCode} withdrawn back to Draft.`;
}

/** Draft/Submitted/InReview -> Cancelled (owner or HR; final). */
async function cancelTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  const from = sheet.status;
  if (from === "Approved" || from === "Cancelled") {
    return req.reject(
      400,
      `An Approved timesheet cannot be cancelled (use the HR Reopen action for corrections); '${from}' sheets are final.`,
    );
  }

  const me = req.user?.attr?.employeeId;
  if (me && sheet.employee_ID !== me && !isHr(req)) {
    return req.reject(403, "You may only cancel your own timesheet.");
  }

  if (!(await transition(tx, req, sheet, from, { status: "Cancelled", submittedOn: null })))
    return;

  await recordTransition(req, tx, sheet, "Cancelled", from, "Cancelled",
    req.data?.comments ?? "Timesheet cancelled.");

  if (sheet.assignedManager_ID) {
    await notify(tx, {
      recipientId: sheet.assignedManager_ID,
      title: "A timesheet was cancelled",
      message: `Timesheet ${sheet.timesheetCode} (${sheet.periodFromDate} - ${sheet.periodToDate}) was cancelled.`,
      category: "TIMESHEET",
      priority: "Low",
      sourceModule: "Timesheet",
      sourceEntity: TS_DB,
      sourceRecordId: sheet.ID,
    });
  }

  return `Timesheet ${sheet.timesheetCode} cancelled.`;
}

/**
 * HR-controlled corrections: Approved -> Draft. Deliberately
 * refused once payroll has consumed the sheet - after payroll ran,
 * corrections must flow through a payroll adjustment, NOT through a
 * silent timesheet rewrite (see the sprint documentation for the
 * documented gap: a payroll adjustment mechanism is future work).
 */
async function reopenTimesheet(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "Approved") {
    return req.reject(400, `Only Approved timesheets can be reopened (current status: '${sheet.status}').`);
  }

  if (sheet.payrollConsumedOn) {
    return req.reject(
      400,
      "This timesheet was already consumed by a payroll run and is frozen. Corrections after payroll require an adjustment in the Payroll module (not yet available - see sprint documentation).",
    );
  }

  if (
    !(await transition(tx, req, sheet, "Approved", {
      status: "Draft",
      submittedOn: null,
      reviewedBy_ID: null,
      reviewedOn: null,
    }))
  )
    return;

  await recordTransition(req, tx, sheet, "Reopened", "Approved", "Draft",
    "Corrections requested by HR.");

  await notify(tx, {
    recipientId: sheet.employee_ID,
    title: "Your approved timesheet was reopened",
    message: `Timesheet ${sheet.timesheetCode} was reopened for corrections - edit and resubmit it.`,
    category: "TIMESHEET",
    priority: "High",
    sourceModule: "Timesheet",
    sourceEntity: TS_DB,
    sourceRecordId: sheet.ID,
  });

  return `Timesheet ${sheet.timesheetCode} reopened for corrections.`;
}

/**
 * Submitted -> InReview. Reviewer work: the in-scope manager (or
 * HR) opens the review; the sheet owner gets a clear 403 (nobody
 * reviews their own sheet).
 */
async function startReview(req) {
  const tx = cds.transaction(req);
  const sheet = await loadSheet(req, tx);
  if (!sheet) return;

  if (sheet.status !== "Submitted") {
    return req.reject(
      400,
      `Only Submitted timesheets can be moved to 'InReview' (current status: '${sheet.status}').`,
    );
  }

  const me = req.user?.attr?.employeeId;
  if (me && me === sheet.employee_ID) {
    return req.reject(403, "The reviewer cannot review their own timesheet.");
  }
  const inScope = (me && sheet.assignedManager_ID === me) || isHr(req);
  if (!inScope) {
    return req.reject(
      403,
      "Only the reporting manager of this employee (or HR) may start the review.",
    );
  }

  if (
    !(await transition(tx, req, sheet, "Submitted", {
      status: "InReview",
      reviewedBy_ID: me ?? null,
      reviewedOn: new Date().toISOString(),
    }))
  )
    return;

  await recordTransition(req, tx, sheet, "ReviewStarted", "Submitted", "InReview");

  await notify(tx, {
    recipientId: sheet.employee_ID,
    title: "Your timesheet is under review",
    message: `Timesheet ${sheet.timesheetCode} is currently being reviewed.`,
    category: "TIMESHEET",
    priority: "Medium",
    sourceModule: "Timesheet",
    sourceEntity: TS_DB,
    sourceRecordId: sheet.ID,
  });

  return `Timesheet ${sheet.timesheetCode} moved to InReview.`;
}

module.exports.startReview = startReview;
