const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 15 - TIMESHEET -> PAYROLL INTEGRATION
// ------------------------------------------------------------
// HOW APPROVED TIMESHEETS REACH PAYROLL (and where the payroll
// calculations still live):
//
//   * CALCULATION stays 100% inside the Payroll module: this file
//     computes nothing and pays nothing. The existing payroll
//     engine derives pay from attendance days and the approved
//     Overtime records (Sprint 6) - unchanged.
//
//   * CONSUMPTION is what this file adds. When the payroll engine
//     successfully creates an employee's PayrollProcess row for a
//     period, it calls consumeApprovedTimesheets() INSIDE THE SAME
//     transaction. Every Approved, not-yet-consumed timesheet whose
//     period intersects the payroll period is then marked consumed
//     (payrollConsumedOn + payrollPeriod). This is set-once:
//       - a second payroll run for the same period finds nothing
//         to consume -> the same hours are never counted twice,
//       - consistent rejection: consumption rolls back together
//         with the payroll insert (single transaction).
//
//   * FREEZE: a consumed sheet rejects lifecycle edits (Reopen /
//     Approve paths check payrollConsumedOn) and direct PATCHes.
//     Corrections after payroll are therefore impossible through
//     the timesheet API - they DOCUMENT the required payroll
//     adjustment mechanism as future work (see sprint report) .
//
//   * The engine must NEVER claim that payment happened: consuming
//     only means "these approved hours were taken into account by
//     payroll calc for period X". Payment status stays with the
//     PayrollProcess/period lifecycle.
// ============================================================

const TS_DB = "ewms.db.timesheet.Timesheet";
const HISTORY_DB = "ewms.db.timesheet.TimesheetHistory";

/**
 * Consumes the employee's approved, unconsumed timesheets covering
 * the given payroll period. MUST be called on a transaction that
 * also creates the PayrollProcess rows (atomicity + idempotency).
 *
 * @param {object} tx      the payroll transaction
 * @param {object} req     the ProcessPayroll request (for audit ctx)
 * @param {string} employeeId
 * @param {object} period  PayrollPeriod row { ID, startDate, endDate, payrollCode }
 * @returns number of newly consumed sheets (0 when nothing open)
 */
async function consumeApprovedTimesheets(tx, req, employeeId, period) {
  if (!period?.ID || !period.startDate || !period.endDate) return 0;

  const sheets = await tx.run(
    SELECT.from(TS_DB).where`
      employee_ID = ${employeeId}
      and status = 'Approved'
      and payrollConsumedOn is null
      and periodFromDate <= ${period.endDate}
      and periodToDate >= ${period.startDate}
    `,
  );
  if (!sheets.length) return 0;

  const consumedOn = new Date().toISOString();

  for (const sheet of sheets) {
    await tx.run(
      UPDATE(TS_DB)
        .set({ payrollConsumedOn: consumedOn, payrollPeriod_ID: period.ID })
        .where({ ID: sheet.ID }),
    );

    // Ledger row: the consumption is part of the sheet's history.
    try {
      await tx.run(
        INSERT.into(HISTORY_DB).entries({
          timesheet_ID: sheet.ID,
          action: "PayrollConsumed",
          previousStatus: "Approved",
          newStatus: "Approved",
          actor_ID: req?.user?.attr?.employeeId ?? null,
          actedOn: consumedOn,
          comments: `Consumed by payroll period ${period.payrollCode ?? period.ID}.`,
        }),
      );
    } catch (e) {
      cds.log("timesheet").error("history write failed:", e.message);
    }

    await notify(tx, {
      recipientId: sheet.employee_ID,
      title: "Your timesheet was taken into payroll",
      message: `Timesheet ${sheet.timesheetCode} was consumed by payroll period ${period.payrollCode ?? ""}.`.trim(),
      category: "TIMESHEET",
      priority: "Low",
      sourceModule: "Timesheet",
      sourceEntity: TS_DB,
      sourceRecordId: sheet.ID,
    });
  }

  await persistAudit(
    req,
    "PayrollConsumed",
    "Timesheets",
    null,
    {
      payrollPeriod_ID: period.ID,
      consumedCount: sheets.length,
      timesheetIds: sheets.map((s) => s.ID),
    },
  );

  return sheets.length;
}

module.exports = { consumeApprovedTimesheets };
