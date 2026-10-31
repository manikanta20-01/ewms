const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { alreadyNotified } = require("../../compliance/handlers/compliance-rules");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 24 - TIMESHEET DRAFT REMINDER JOB
// ------------------------------------------------------------
// Reminds employees whose timesheets are still in Draft even
// though the reporting period has FULLY ended.
//
// Beginner summary of the rules:
//   * Source of truth = the timesheet module's own status
//     ('Draft') and period dates - no duplicate status model.
//   * Eligible: status = 'Draft' AND periodToDate < asOfDate
//     (the period is completely over; the sheet was never
//     submitted for review).
//   * Future periods and in-period drafts are NOT eligible -
//     normal work in progress must not be nagged.
//   * One reminder per timesheet, ever (dedupe on recipient +
//     title + timesheet ID). Re-runs and retries are safe.
//   * The job never changes the sheet's status and never submits
//     anything - business decisions stay with the employee.
// ============================================================

const TIMESHEET_ENTITY = "ewms.db.timesheet.Timesheet";

const TITLE = "Unsubmitted timesheet";
const CATEGORY = "TIMESHEET";

let LOG;
function logger() {
  if (!LOG) LOG = cds.log("jobs/timesheet-drafts");
  return LOG;
}

async function run(tx, { now, maxRows }) {
  const asOf = now || new Date().toISOString().slice(0, 10);

  const sheets = await tx.run(
    SELECT.from(TIMESHEET_ENTITY)
      .columns("ID", "timesheetCode", "employee_ID", "periodFromDate", "periodToDate")
      .where({ status: "Draft" })
      .limit(maxRows || 500),
  );

  let sent = 0;
  let scanned = 0;

  for (const sheet of sheets || []) {
    scanned += 1;

    const ended = sheet.periodToDate && String(sheet.periodToDate).slice(0, 10) < asOf;
    if (!ended) continue;

    if (await alreadyNotified(tx, { recipientId: sheet.employee_ID, title: TITLE, sourceRecordId: sheet.ID })) {
      continue;
    }
    if (!sheet.employee_ID) continue;

    const ok = await notify(tx, {
      recipientId: sheet.employee_ID,
      title: TITLE,
      message: `Timesheet ${sheet.timesheetCode || sheet.ID} for ${sheet.periodFromDate} to ${sheet.periodToDate} is still a draft. Please review and submit it.`,
      category: CATEGORY,
      priority: "Medium",
      sourceModule: "TIMESHEET",
      sourceEntity: TIMESHEET_ENTITY,
      sourceRecordId: sheet.ID,
    });
    if (ok) sent += 1;
    else logger().warn(`Reminder for timesheet ${sheet.ID} could not be persisted.`);
  }

  return { reminders: sent, sheetsScanned: scanned, asOf };
}

module.exports = { run };
