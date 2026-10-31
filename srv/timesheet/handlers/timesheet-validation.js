const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { assertSelfCreate } = require("../../common/utils/self-write-guard");
const { generateCode } = require("../../common/utils/code-generator");

// ============================================================
// SPRINT 15 - TIMESHEET VALIDATION (CRUD-level guards)
// ------------------------------------------------------------
// Beginner-friendly summary of what this file enforces:
//
//  * A plain employee may only create timesheets for THEMSELVES
//    (row-level self-write guard, shared utility).
//  * A sheet can be edited only while it is in 'Draft' status -
//    Submitted/InReview/Approved sheets are frozen against direct
//    PATCH; status changes happen only through the bound lifecycle
//    actions (timesheet-lifecycle.js).
//  * A new sheet's reporting period must not overlap any other
//    still-active (Draft/Submitted/InReview/Approved) timesheet of
//    the SAME employee. Cancelled sheets free their period again.
//    This is the main defence against double-counted hours.
//  * Every work item must fall inside the header period, inside an
//    active EmployeeAssignment (Sprint 4) covering that workDate,
//    and on a day attendance (Sprint 6) does not report as
//    Leave/Holiday/WeekOff/Absent.
//  * Hours are COMPUTED from start/end/break, not trusted from the
//    payload. Overnight entries (end time smaller than start time)
//    automatically cross midnight. Overtime uses the same 8h
//    standard day the attendance/overtime modules use.
// ============================================================

// Entity names: registration happens on the SERVICE entity short name,
// every query/update addresses the full DB entity name (project
// convention, see performance/review-lifecycle.js).
const TIMESHEETS = "Timesheets"; // registration
const ITEMS = "TimesheetItems"; // registration
const TS_DB = "ewms.db.timesheet.Timesheet";
const ITEM_DB = "ewms.db.timesheet.TimesheetItem";
const ASSIGN_DB = "ewms.db.employee.EmployeeAssignment";
const EMPLOYEE_DB = "ewms.db.employee.Employee";
const SHIFT_DB = "ewms.db.attendance.Shift";
const ATTENDANCE_DB = "ewms.db.attendance.Attendance";

// Standard work day. The attendance module computes overtime as
// "worked hours beyond the 8h standard" (overtime.js) and payroll
// factors overtime by 1.5 - reuse that convention, do not invent a
// company-specific policy here.
const STANDARD_DAY_HOURS = 8;

// Statuses that block a period from being reused by a new sheet.
// 'Cancelled' is deliberately NOT in the list - a cancelled sheet
// releases its period. Rejected never persists (rejection returns
// the sheet to Draft with the reason recorded).
const ACTIVE_STATUSES = ["Draft", "Submitted", "InReview", "Approved"];

/** Normalizes the bound-action / bound-CRUD key predicate (raw UUID safe). */
function keysOf(req) {
  const p = req.params?.[0];
  return p ? (typeof p === "object" ? p : { ID: p }) : { ID: req.data?.ID };
}

function today() {
  return new Date().toISOString().split("T")[0];
}

/** rejects with a plain Error carrying an HTTP-friendly status. */
const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};

/**
 * Computes regular/overtime hours for one work entry.
 * data: { startTime, endTime, breakHours, shift_ID }
 *
 * Shift template fallback: a shift reference without explicit times
 * records the shift's own hours; endTime < startTime means the shift
 * runs overnight (crosses midnight) and +24h is applied.
 */
async function computeItemHours(tx, data) {
  let startTime = data.startTime ?? null;
  let endTime = data.endTime ?? null;

  if (!startTime && !endTime && data.shift_ID) {
    const shiftRow = await tx.run(
      SELECT.one.from(SHIFT_DB).where({ ID: data.shift_ID }),
    );
    if (shiftRow) {
      startTime = shiftRow.startTime;
      endTime = shiftRow.endTime;
    }
  }

  if (!startTime && !endTime) {
    // A day reference without times is recorded with zero hours.
    return { regularHours: 0, overtimeHours: 0 };
  }

  if (!startTime || !endTime) {
    fail("Start and end time must both be given (or left empty for a plain day reference).");
  }

  const t2m = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + (m || 0);
  };

  let worked = t2m(endTime) - t2m(startTime);
  if (worked < 0) worked += 24 * 60; // overnight: matches shift.cds semantics

  const breakMinutes = Math.round(Number(data.breakHours || 0) * 60);
  if (breakMinutes < 0) fail("Break hours cannot be negative.");
  if (breakMinutes >= worked) fail("Break hours cannot exceed the recorded working time.");

  worked -= breakMinutes;
  if (worked <= 0) fail("Recorded working time must be positive after breaks.");

  const workedHours = Number((worked / 60).toFixed(2));
  return {
    regularHours: Math.min(workedHours, STANDARD_DAY_HOURS),
    overtimeHours: Number(Math.max(0, workedHours - STANDARD_DAY_HOURS).toFixed(2)),
  };
}

/**
 * Validates one item against period bounds, employment
 * assignments (Sprint 4) and attendance (Sprint 6). Returns the
 * covering assignment row (or null when only chosenAssignmentId
 * was verified - picked in the caller).
 */
async function validateWorkDate(tx, employee_ID, workDate, period, chosenAssignmentId) {
  if (workDate < period.periodFromDate || workDate > period.periodToDate) {
    fail(
      `Work date ${workDate} is outside the timesheet period ` +
        `(${period.periodFromDate} to ${period.periodToDate}).`,
    );
  }

  // Timesheets record work that has already happened.
  if (workDate > today()) {
    fail("Work dates cannot be in the future - timesheets record work already done.");
  }

  // Assignment resolution/verification (Sprint 4 rule reuse):
  // the work day must be covered by an assignment where
  //   employee matches AND fromDate <= workDate AND (toDate null or >= workDate).
  let assignment;
  if (chosenAssignmentId) {
    assignment = await tx.run(
      SELECT.one.from(ASSIGN_DB).where({ ID: chosenAssignmentId }),
    );
    if (!assignment) fail("Selected employee assignment does not exist.");
    if (assignment.employee_ID !== employee_ID) {
      fail("Selected employee assignment belongs to another employee.");
    }
  } else {
    const matches = await tx.run(
      SELECT.from(ASSIGN_DB).where({ employee_ID }).orderBy("fromDate desc"),
    );
    assignment =
      matches.find(
        (a) => workDate >= a.fromDate && (!a.toDate || workDate <= a.toDate),
      ) || null;
    if (!assignment) {
      fail(
        `No employee assignment covers ${workDate} - attach the work to a valid assignment (from '${period.periodFromDate}').`,
      );
    }
  }

  // Attendance reconciliation (Sprint 6 rule reuse): work cannot be
  // logged on days attendance reports as non-working. WorkFromHome /
  // OnDuty days remain valid timesheet days. Hours equality is
  // deliberately NOT enforced (authorized exceptions such as
  // off-site work exist) - documented in the sprint report.
  const attendance = await tx.run(
    SELECT.one.from(ATTENDANCE_DB).where({ employee_ID, attendanceDate: workDate }),
  );
  if (
    attendance &&
    ["Leave", "Holiday", "WeekOff", "Absent"].includes(attendance.attendanceStatus)
  ) {
    fail(
      `Attendance reports '${attendance.attendanceStatus}' for ${workDate} - work cannot be logged for that day.`,
    );
  }

  return assignment;
}

/** Recomputes the header totals from its items (within current tx). */
async function recomputeTotals(tx, timesheetId) {
  const items = await tx.run(
    SELECT.from(ITEM_DB).where({ timesheet_ID: timesheetId }),
  );
  const regular = items.reduce((s, i) => s + Number(i.regularHours || 0), 0);
  const overtime = items.reduce((s, i) => s + Number(i.overtimeHours || 0), 0);
  await tx.run(
    UPDATE(TS_DB)
      .set({
        regularHours: Number(regular.toFixed(2)),
        overtimeHours: Number(overtime.toFixed(2)),
      })
      .where({ ID: timesheetId }),
  );
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // TIMESHEET HEADER: CREATE
  // ----------------------------------------------------------
  srv.before("CREATE", TIMESHEETS, async (req) => {
    const tx = cds.transaction(req);

    // Row-level self-service guard: where-clauses cannot filter
    // CREATEs, so a plain employee could otherwise POST a sheet
    // for a colleague (same defence attendance/leave use).
    await assertSelfCreate(req, "employee_ID", ["HR"]);

    const { employee_ID, periodFromDate, periodToDate } = req.data;
    if (!employee_ID) return req.error(400, "Employee is required.");
    if (!periodFromDate || !periodToDate) {
      return req.error(400, "The reporting period (from/to date) is required.");
    }
    if (periodToDate < periodFromDate) {
      return req.error(400, "Period to date must be on or after the from date.");
    }

    const employee = await tx.run(
      SELECT.one.from(EMPLOYEE_DB).where({ ID: employee_ID }),
    );
    if (!employee) return req.error(400, "Employee not found.");

    // Overlap guard: only ONE active sheet per employee may cover a
    // given day.
    const overlap = await tx.run(
      SELECT.one.from(TS_DB).where`
        employee_ID = ${employee_ID}
        and status in (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ")})
        and periodToDate >= ${periodFromDate}
        and periodFromDate <= ${periodToDate}
      `,
    );
    if (overlap) {
      return req.error(
        400,
        `Employee already has a '${overlap.status}' timesheet overlapping this period ` +
          `(${overlap.periodFromDate} to ${overlap.periodToDate}): ${overlap.timesheetCode ?? overlap.ID}.`,
      );
    }

    req.data.timesheetCode = await generateCode(
      req,
      TS_DB,
      "timesheetCode",
      "TS",
      6,
    );
  });

  // ----------------------------------------------------------
  // TIMESHEET HEADER: UPDATE (direct PATCH protection)
  // ----------------------------------------------------------
  srv.before("UPDATE", TIMESHEETS, async (req) => {
    const tx = cds.transaction(req);
    const current = await tx.run(SELECT.one.from(TS_DB).where(keysOf(req)));
    if (!current) return req.error(404, "Timesheet not found.");

    // System-controlled fields can never be set through a direct
    // PATCH - status belongs to the lifecycle actions, payroll
    // consumption belongs to the payroll engine. This blocks
    // "approve myself via PATCH" attempts for good.
    if ("status" in req.data) {
      return req.error(
        400,
        "Status changes must go through the lifecycle actions (Submit/StartReview/Approve/Reject/Withdraw/Cancel/Reopen).",
      );
    }
    if ("payrollConsumedOn" in req.data || "payrollPeriod_ID" in req.data) {
      return req.error(400, "Payroll consumption is controlled by the Payroll module.");
    }
    if ("regularHours" in req.data || "overtimeHours" in req.data) {
      return req.error(400, "Totals are computed from the work items.");
    }

    // After the first submit the sheet is frozen. Corrections after
    // approval run only through the HR Reopen action.
    if (current.status !== "Draft") {
      return req.error(
        400,
        `A timesheet in '${current.status}' status can no longer be edited. Only Draft sheets may be changed.`,
      );
    }

    // Period changes are Draft-only edits: revalidate them.
    if ("periodFromDate" in req.data || "periodToDate" in req.data) {
      const from = req.data.periodFromDate ?? current.periodFromDate;
      const to = req.data.periodToDate ?? current.periodToDate;
      if (to < from) {
        return req.error(400, "Period to date must be on or after the from date.");
      }

      const others = await tx.run(
        SELECT.from(TS_DB).where`
          employee_ID = ${current.employee_ID}
          and status in (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ")})
          and periodToDate >= ${from}
          and periodFromDate <= ${to}
        `,
      );
      if (others.some((o) => o.ID !== current.ID)) {
        return req.error(400, "The changed period overlaps another active timesheet of this employee.");
      }
    }
  });

  // ----------------------------------------------------------
  // TIMESHEET HEADER: DELETE -> prohibited (audit integrity)
  // ----------------------------------------------------------
  srv.before("DELETE", TIMESHEETS, (req) => {
    return req.error(
      400,
      "Timesheets cannot be deleted. Withdraw, Reject or Cancel them instead.",
    );
  });

  // ----------------------------------------------------------
  // HISTORY LEDGER: append-only
  // ----------------------------------------------------------
  srv.before(["CREATE", "UPDATE", "DELETE"], "TimesheetHistories", (req) => {
    return req.error(400, "The timesheet history is written only by the lifecycle actions.");
  });

  // ----------------------------------------------------------
  // WORK ITEMS: CREATE
  // ----------------------------------------------------------
  srv.before("CREATE", ITEMS, async (req) => {
    const tx = cds.transaction(req);
    const { timesheet_ID, workDate } = req.data;

    if (!timesheet_ID) return req.error(400, "Timesheet is required.");
    if (!workDate) return req.error(400, "Work date is required.");

    const header = await tx.run(SELECT.one.from(TS_DB).where({ ID: timesheet_ID }));
    if (!header) return req.error(404, "Timesheet not found.");
    if (header.status !== "Draft") {
      return req.error(
        400,
        `Work items can only be added while the timesheet is in 'Draft' status (current: '${header.status}').`,
      );
    }

    // Duplicate protection: one item per work date per sheet.
    const duplicate = await tx.run(
      SELECT.one.from(ITEM_DB).where({ timesheet_ID, workDate }),
    );
    if (duplicate) {
      return req.error(400, `A work entry for ${workDate} already exists in this timesheet.`);
    }

    const assignment = await validateWorkDate(
      tx,
      header.employee_ID,
      workDate,
      header,
      req.data.employeeAssignment_ID,
    );

    // Auto-attach the covering assignment and its project when the
    // caller did not choose one explicitly (work attribution
    // defaults to the assignment the day is covered by).
    req.data.employeeAssignment_ID =
      req.data.employeeAssignment_ID ?? assignment?.ID ?? null;
    if (!req.data.project_ID && assignment?.project_ID) {
      req.data.project_ID = assignment.project_ID;
    }

    const hours = await computeItemHours(tx, req.data);
    req.data.regularHours = hours.regularHours;
    req.data.overtimeHours = hours.overtimeHours;
  });

  srv.after("CREATE", ITEMS, async (data, req) => {
    const tx = cds.transaction(req);
    await recomputeTotals(tx, data.timesheet_ID);
  });

  // ----------------------------------------------------------
  // WORK ITEMS: UPDATE (draft-only; revalidates everything)
  // ----------------------------------------------------------
  srv.before("UPDATE", ITEMS, async (req) => {
    const tx = cds.transaction(req);

    const itemId = keysOf(req)?.ID;
    if (!itemId) return req.error(400, "Work item key is required.");

    const item = await tx.run(SELECT.one.from(ITEM_DB).where({ ID: itemId }));
    if (!item) return req.error(404, "Work item not found.");

    const header = await tx.run(
      SELECT.one.from(TS_DB).where({ ID: item.timesheet_ID }),
    );
    if (!header) return req.error(404, "Timesheet not found.");
    if (header.status !== "Draft") {
      return req.error(
        400,
        `Work items can only be changed while the timesheet is in 'Draft' status (current: '${header.status}').`,
      );
    }
    if ("timesheet_ID" in req.data && req.data.timesheet_ID !== item.timesheet_ID) {
      return req.error(400, "A work item cannot be moved to another timesheet.");
    }

    const merged = {
      startTime: req.data.startTime ?? item.startTime,
      endTime: req.data.endTime ?? item.endTime,
      breakHours: req.data.breakHours ?? item.breakHours,
      shift_ID: req.data.shift_ID ?? item.shift_ID,
    };

    const workDate = req.data.workDate ?? item.workDate;
    const assignment = await validateWorkDate(
      tx,
      header.employee_ID,
      workDate,
      header,
      req.data.employeeAssignment_ID ?? item.employeeAssignment_ID,
    );
    req.data.employeeAssignment_ID =
      req.data.employeeAssignment_ID ?? item.employeeAssignment_ID ?? assignment?.ID ?? null;

    if (workDate !== item.workDate) {
      const duplicate = await tx.run(
        SELECT.one.from(ITEM_DB).where({ timesheet_ID: item.timesheet_ID, workDate }),
      );
      if (duplicate && duplicate.ID !== item.ID) {
        return req.error(400, `A work entry for ${workDate} already exists in this timesheet.`);
      }
    }

    const hours = await computeItemHours(tx, merged);
    req.data.regularHours = hours.regularHours;
    req.data.overtimeHours = hours.overtimeHours;
  });

  srv.after("UPDATE", ITEMS, async (data, req) => {
    const tx = cds.transaction(req);
    const item = await tx.run(SELECT.one.from(ITEM_DB).where({ ID: keysOf(req)?.ID }));
    if (item) await recomputeTotals(tx, item.timesheet_ID);
  });

  // ----------------------------------------------------------
  // WORK ITEMS: DELETE (draft-only; totals recomputed)
  // ----------------------------------------------------------
  srv.before("DELETE", ITEMS, async (req) => {
    const tx = cds.transaction(req);
    const ID = keysOf(req)?.ID;
    if (!ID) return;

    const item = await tx.run(SELECT.one.from(ITEM_DB).where({ ID }));
    if (!item) return;

    const header = await tx.run(
      SELECT.one.from(TS_DB).where({ ID: item.timesheet_ID }),
    );
    if (header?.status !== "Draft") {
      return req.error(
        400,
        `Work items can only be removed while the timesheet is in 'Draft' status (current: '${header.status}').`,
      );
    }

    // Shared between the guard and the after-hook below.
    req._deletedItemSheetId = item.timesheet_ID;
  });

  srv.after("DELETE", ITEMS, async (_, req) => {
    const tx = cds.transaction(req);
    if (req._deletedItemSheetId) {
      await recomputeTotals(tx, req._deletedItemSheetId);
    }
  });
};
