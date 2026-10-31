sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Timesheet detail controller.
  //
  // ALL lifecycle changes go through the real bound actions of
  // TimesheetService (Submit / StartReview / Approve / Reject /
  // Withdraw / Cancel / Reopen). Status fields are never PATCHed
  // from the UI; the backend transitions, self-approval guard and
  // payroll-locks stay authoritative here.
  //
  // Button visibility is a convenience guess from the status; the
  // backend may still reject ("Only Draft timesheets...", 403...)
  // and that real error is displayed. No fake success anywhere.
  return Controller.extend("ewms.EWMS.controller.TimesheetDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        ID: "", code: "", employeeText: "", periodText: "",
        statusText: "", status: "",
        regularHours: "", overtimeHours: "",
        submittedOn: "", reviewedOn: "", comments: "",
        items: [], busy: false, error: false, errorText: "",
        // Action affordances (hints; backend enforces for real).
        canSubmit: false, canStartReview: false, canApprove: false,
        canReject: false, canWithdraw: false, canCancel: false,
        canReopen: false, canAddItem: false,
        // Add-entry dialog
        itemDraft: {}, itemError: "",
        // Comments dialog (Approve/Reject/Cancel)
        commentAction: "", commentTitle: "", commentValue: "", commentError: ""
      });
      this.getView().setModel(this.oModel, "tsd");

      this.getOwnerComponent().getRouter().getRoute("timesheetDetail")
        .attachPatternMatched(this._onMatched, this);
    },

    _onMatched: function (oEvent) {
      this._sId = oEvent.getParameter("arguments").id;
      this._load();
    },

    onReload: function () { this._load(); },

    _load: function () {
      const oModel = this.oModel;
      oModel.setProperty("/busy", true);
      oModel.setProperty("/error", false);

      Backend.readTimesheetDetail(this._sId)
        .then(oRow => Backend.readEmployeeMap([oRow.employee_ID]).then(mEmp => {
          const sStatus = oRow.status || "";
          oModel.setProperty("/ID", oRow.ID);
          oModel.setProperty("/code", oRow.timesheetCode || "—");
          oModel.setProperty("/employeeText", mEmp[oRow.employee_ID] || "—");
          oModel.setProperty("/periodText",
            Backend.fmtDate(oRow.periodFromDate) + " → " + Backend.fmtDate(oRow.periodToDate));
          oModel.setProperty("/status", sStatus);
          oModel.setProperty("/statusText", Backend.label(sStatus));
          oModel.setProperty("/regularHours", oRow.regularHours == null ? "—" : oRow.regularHours);
          oModel.setProperty("/overtimeHours", oRow.overtimeHours == null ? "—" : oRow.overtimeHours);
          oModel.setProperty("/submittedOn", Backend.fmtDate(oRow.submittedOn));
          oModel.setProperty("/reviewedOn", Backend.fmtDate(oRow.reviewedOn));
          oModel.setProperty("/comments", oRow.reviewerComments || "");
          oModel.setProperty("/error", false);
          oModel.setProperty("/busy", false);
          // Wait for the item list, then paint together.
          oModel.setProperty("/items",
            (oRow.items || []).map(i => ({
              workDate: Backend.fmtDate(i.workDate),
              timeText: Backend.fmtTime(i.startTime) + " – " + Backend.fmtTime(i.endTime),
              breakHours: i.breakHours == null ? "—" : i.breakHours,
              regularHours: i.regularHours == null ? "—" : i.regularHours,
              overtimeHours: i.overtimeHours == null ? "—" : i.overtimeHours,
              notes: i.notes || "—"
            })));
          this._paintButtons(sStatus);
        }))
        .catch(oErr => {
          oModel.setProperty("/items", []);
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oErr.message);
          oModel.setProperty("/busy", false);
        });
    },

    _paintButtons: function (sStatus) {
      const bEditable = ["Draft", "Submitted", "InReview", "Approved"].includes(sStatus);
      const set = (k, v) => this.oModel.setProperty("/" + k, v);
      set("canSubmit", sStatus === "Draft");
      set("canStartReview", sStatus === "Submitted");
      set("canApprove", sStatus === "InReview");
      set("canReject", sStatus === "Submitted" || sStatus === "InReview");
      set("canWithdraw", sStatus === "Submitted" || sStatus === "InReview");
      set("canCancel", sStatus === "Draft" || sStatus === "Submitted" || sStatus === "InReview");
      set("canReopen", sStatus === "Approved");
      set("canAddItem", sStatus === "Draft" && bEditable);
    },

    // ---------------------------------------------------------------
    // Lifecycle actions (real bound actions). Comments-parameterized
    // actions open a comments dialog; others fire immediately.
    // ---------------------------------------------------------------
    _fireAction: function (sActionName, mParams) {
      const oModel = this.oModel;
      oModel.setProperty("/busy", true);
      Backend.timesheetAction(this._sId, sActionName, mParams || {})
        .then(oResp => {
          oModel.setProperty("/busy", false);
          MessageToast.show(
            (oResp && (oResp.message || oResp.value)) ||
            ("Timesheet action '" + sActionName + "' accepted by the backend."));
          this._load();
        })
        .catch(oErr => {
          oModel.setProperty("/busy", false);
          MessageToast.show(oErr.message);
        });
    },

    onSubmit: function () { this._fireAction("Submit"); },
    onStartReview: function () { this._fireAction("StartReview"); },
    onWithdraw: function () { this._fireAction("Withdraw"); },
    onReopen: function () { this._fireAction("Reopen"); },

    onApprove: function () { this._openComments("Approve", "Approve timesheet"); },
    onReject: function () { this._openComments("Reject", "Reject timesheet (returns to Draft)"); },
    onCancel: function () { this._openComments("Cancel", "Cancel timesheet"); },

    _openComments: function (sAction, sTitle) {
      this.oModel.setProperty("/commentAction", sAction);
      this.oModel.setProperty("/commentTitle", sTitle);
      this.oModel.setProperty("/commentValue", "");
      this.oModel.setProperty("/commentError", "");
      if (!this._oCommentsDlg) {
        this._oCommentsDlg = sap.ui.xmlfragment(
          this.getView().getId(), "ewms.EWMS.view.CommentsDialog", this);
        this.getView().addDependent(this._oCommentsDlg);
      }
      this._oCommentsDlg.open();
    },

    onCommentsCancel: function () {
      if (this._oCommentsDlg) { this._oCommentsDlg.close(); }
    },

    onCommentsConfirm: function () {
      const oM = this.oModel;
      const sAction = oM.getProperty("/commentAction");
      const sText = (oM.getProperty("/commentValue") || "").trim();
      // Backend rule: rejecting a timesheet REQUIRES a reason.
      if (sAction === "Reject" && !sText) {
        oM.setProperty("/commentError", "A reason is required when rejecting a timesheet.");
        return;
      }
      // Duplicate-submission guard: one in-flight action at a time.
      if (oM.getProperty("/busy")) { return; }
      oM.setProperty("/busy", true);
      Backend.timesheetAction(this._sId, sAction, { comments: sText })
        .then(oResp => {
          oM.setProperty("/busy", false);
          this._oCommentsDlg.close();
          MessageToast.show(
            (oResp && (oResp.message || oResp.value)) ||
            ("Timesheet action '" + sAction + "' accepted by the backend."));
          this._load();
        })
        .catch(oErr => {
          oM.setProperty("/busy", false);
          oM.setProperty("/commentError", oErr.message);
        });
    },

    // ---------------------------------------------------------------
    // Work entries (TimesheetItems): real POST on the Draft sheet.
    // Hours are computed by the BACKEND from start/end times and
    // validated against the period, the employee assignment and the
    // attendance calendar - the UI does none of that locally.
    // ---------------------------------------------------------------
    onAddItem: function () {
      this.oModel.setProperty("/itemDraft", { workDate: "", startTime: "", endTime: "", breakHours: 0, notes: "" });
      this.oModel.setProperty("/itemError", "");
      if (!this._oItemDlg) {
        this._oItemDlg = sap.ui.xmlfragment(
          this.getView().getId(), "ewms.EWMS.view.AddTimesheetItemDialog", this);
        this.getView().addDependent(this._oItemDlg);
      }
      this._oItemDlg.open();
    },

    onItemCancel: function () { if (this._oItemDlg) { this._oItemDlg.close(); } },

    onItemSave: function () {
      const oM = this.oModel;
      const m = oM.getProperty("/itemDraft") || {};
      if (!m.workDate || !m.startTime || !m.endTime) {
        oM.setProperty("/itemError", "Work date, start and end time are required.");
        return;
      }
      if (oM.getProperty("/busy")) { return; }
      oM.setProperty("/busy", true);
      oM.setProperty("/itemError", "");
      Backend.createTimesheetItem({
        timesheet_ID: this._sId,
        workDate: m.workDate,
        startTime: m.startTime,
        endTime: m.endTime,
        breakHours: Number(m.breakHours || 0),
        notes: m.notes || null
      })
        .then(() => {
          oM.setProperty("/busy", false);
          this._oItemDlg.close();
          MessageToast.show("Work entry added (backend).");
          this._load();
        })
        .catch(oErr => {
          oM.setProperty("/busy", false);
          oM.setProperty("/itemError", oErr.message);
        });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("timesheets");
    }
  });
});
