const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const engine = require("../../workflow/handlers/workflow-engine");
const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");

// ============================================================
// SPRINT 15 - TIMESHEET <-> GENERIC WORKFLOW INTEGRATION
// ------------------------------------------------------------
// DELEGATES the multi-step approval to the Sprint 10 generic
// workflow engine instead of building a second approval flow:
//
//   * StartWorkflow is an OPTIONAL opt-in action on a Draft or
//     Submitted sheet (definition WF-TIMESHEET-STD is seeded);
//     the direct manager actions above remain fully functional.
//   * applyDecision: when the instance reaches a final status the
//     sheet status is synced (Approved / Cancelled) and the
//     employee or manager is notified through the shared core.
//     Self-approval and scope enforcement stay with the engine's
//     task rules - no duplicate authorization logic here.
//   * applyRework: SendBack returns the sheet to Draft (editable).
//   * applyResubmit: resubmission restarts the same instance.
// ============================================================

const TS_DB = "ewms.db.timesheet.Timesheet";
const TIMESHEET_TYPE = "ewms.db.timesheet.Timesheet";
const { notify } = require("../../notification/handlers/notification-core");
const { persistAudit } = require("../../common/utils/audit");

registerCallbacks(TIMESHEET_TYPE, {
  applyDecision: async (tx, instance, decision, comments) => {
    const sheet = await tx.run(
      SELECT.one.from(TS_DB).where({ ID: instance.businessObjectId }),
    );
    if (!sheet) return; // sheet deleted meanwhile

    if (decision === "Approved") {
      await tx.run(
        UPDATE(TS_DB)
          .set({
            status: "Approved",
            reviewedOn: new Date().toISOString(),
            reviewerComments: comments || sheet.reviewerComments || null,
          })
          .where({ ID: sheet.ID }),
      );
      await notify(tx, {
        recipientId: sheet.employee_ID,
        title: "Your timesheet was approved",
        message: `Timesheet ${sheet.timesheetCode} is approved via workflow.`,
        category: "TIMESHEET",
        priority: "Medium",
        sourceModule: "Timesheet",
        sourceEntity: TS_DB,
        sourceRecordId: sheet.ID,
      });
    } else if (decision === "Cancelled") {
      // Withdrawn approval journey -> sheet stays Draft; the sheet
      // owner may re-submit later.
      await tx.run(
        UPDATE(TS_DB)
          .set({ status: "Draft", submittedOn: null })
          .where({ ID: sheet.ID }),
      );
      await notify(tx, {
        recipientId: sheet.employee_ID,
        title: "Your timesheet approval was cancelled",
        message: `The approval workflow for timesheet ${sheet.timesheetCode} was cancelled.`,
        category: "TIMESHEET",
        priority: "Medium",
        sourceModule: "Timesheet",
        sourceEntity: TS_DB,
        sourceRecordId: sheet.ID,
      });
    }
    // 'Rejected' (a task decision) advances the engine; a task-level
    // rejection reaching the instance end falls under Cancelled.
    // 'Terminated' is reserved for future admin intervention and
    // deliberately leaves the sheet untouched (same as Leave).
  },

  applyRework: async (tx, instance, comments) => {
    await tx.run(
      UPDATE(TS_DB)
        .set({
          status: "Draft",
          submittedOn: null,
          reviewerComments: comments || "Sent back for corrections.",
        })
        .where({ ID: instance.businessObjectId }),
    );
  },

  applyResubmit: async (tx, instance) => {
    await tx.run(
      UPDATE(TS_DB)
        .set({ status: "Submitted", reviewerComments: "Resubmitted after rework." })
        .where({ ID: instance.businessObjectId }),
    );
  },
});

module.exports = (srv) => {
  srv.on("StartWorkflow", srv.entities.Timesheets, async (req) => {
    const tx = cds.transaction(req);
    const sheetId = req.params?.[0]?.ID || req.params?.[0];
    if (!sheetId) return req.error(400, "Timesheet identifier missing.");

    const sheet = await tx.run(SELECT.one.from(TS_DB).where({ ID: sheetId }));
    if (!sheet) return req.error(404, "Timesheet not found.");

    // Ownership / role check (mirrors the @restrict grants): the
    // owner or HR may attach an approval workflow.
    const me = req.user?.attr?.employeeId;
    const isOwner = me && me === sheet.employee_ID;
    const isHr =
      req.user.is("HRExecutive") ||
      req.user.is("HRAdmin") ||
      req.user.is("SystemAdmin");
    if (!isOwner && !isHr) {
      return req.error(403, "You can only start a workflow for your own timesheet.");
    }

    const from = sheet.status;
    if (from !== "Draft" && from !== "Submitted") {
      return req.error(
        400,
        `A timesheet in '${from}' status cannot enter a workflow. Only Draft or Submitted sheets can.`,
      );
    }

    if (from === "Submitted") {
      // Attach the approval journey right away.
      await tx.run(
        UPDATE(TS_DB)
          .set({ status: "InReview" })
          .where({ ID: sheet.ID }),
      );
    }
    if (from === "Draft") {
      const items = await tx.run(
        SELECT.from("ewms.db.timesheet.TimesheetItem").where({
          timesheet_ID: sheet.ID,
        }),
      );
      if (!items.length) {
        return req.error(400, "A timesheet needs at least one work entry before it can enter a workflow.");
      }
    }

    const result = await engine.startWorkflow(req, {
      businessObjectType: TIMESHEET_TYPE,
      businessObjectId: sheetId,
      requesterId: sheet.employee_ID,
      summary: req.data?.summary ||
        `Timesheet ${sheet.timesheetCode}: ${sheet.regularHours}h regular / ${sheet.overtimeHours}h overtime (${sheet.periodFromDate} - ${sheet.periodToDate})`,
    });

    return result;
  });
};
