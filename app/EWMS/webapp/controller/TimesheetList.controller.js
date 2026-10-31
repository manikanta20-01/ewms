sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Timesheet list controller. Reads REAL backend rows.
  // The backend decides visibility (own sheets / subordinate review);
  // the UI only shapes what arrived. Pagination reuses the Sprint 27
  // list pattern (server-side skip/top).
  const PAGE_SIZE = 50;

  return Controller.extend("ewms.EWMS.controller.TimesheetList", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], count: null,
        busy: false, error: false, errorText: "",
        pageLabel: "", footerLabel: "",
        draft: {}, employeeOptions: [],
        ctError: "", ctBusy: false
      });
      this.getView().setModel(this.oModel, "ts");

      this._page = 0;

      this.getOwnerComponent().getRouter().getRoute("timesheets")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) {
        this._load();
      } else {
        this.oModel.setProperty("/rows", []);
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
      }
    },

    _onMatched: function () {
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this._load();
    },

    _load: function () {
      const oModel = this.oModel;
      oModel.setProperty("/busy", true);
      oModel.setProperty("/error", false);

      Backend.readTimesheets({ top: PAGE_SIZE, skip: this._page * PAGE_SIZE })
        .then(oResult => this._paintRows(oResult))
        .catch(oErr => {
          oModel.setProperty("/rows", []);
          oModel.setProperty("/count", null);
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oErr.message);
          oModel.setProperty("/pageLabel", "");
          oModel.setProperty("/footerLabel", "");
        })
        .finally(() => oModel.setProperty("/busy", false));
    },

    _paintRows: function (oResult) {
      const aRows = oResult.rows || [];
      const asIds = [...new Set(aRows.map(r => r.employee_ID).filter(Boolean))];
      Backend.readEmployeeMap(asIds).then(mEmp => {
        this.oModel.setProperty("/rows", aRows.map(r => ({
          ID: r.ID,
          sheetNumber: r.timesheetCode || "—",
          employeeText: mEmp[r.employee_ID] || "—",
          fromDate: Backend.fmtDate(r.periodFromDate),
          toDate: Backend.fmtDate(r.periodToDate),
          regularHours: r.regularHours == null ? "—" : r.regularHours,
          overtimeHours: r.overtimeHours == null ? "—" : r.overtimeHours,
          statusText: Backend.label(r.status)
        })));
        this.oModel.setProperty("/count", oResult.count);
        this.oModel.setProperty("/pageLabel",
          "Timesheets visible to your role: " +
          (oResult.count == null ? aRows.length : oResult.count));
        this.oModel.setProperty("/footerLabel",
          "Submit / approve / reject are backend lifecycle actions on the detail page.");
      });
    },

    onPrevPage: function () { if (this._page > 0) { this._page--; this._load(); } },
    onNextPage: function () { this._page++; this._load(); },

    onSheetPress: function (oEvt) {
      const sID = oEvt.getSource().getBindingContext("ts").getObject().ID;
      this.getOwnerComponent().getRouter().navTo("timesheetDetail", { id: sID });
    },

    // -----------------------------------------------------------------
    // Create — calls the real POST /Timesheets endpoint. The picker
    // lists only employees this identity may see; the backend re-checks
    // everything (duplicates, period, authorization) and its errors
    // are shown as-is. Nothing is invented on success.
    // -----------------------------------------------------------------
    onCreate: function () {
      // Real employee directory restricted to the caller's scope.
      // (403 for co-worker-only roles would leave the list empty and
      // the backend would then reject the POST - both are honest.)
      Backend.readEmployees({ top: 50 }).then(o => {
        this.oModel.setProperty("/employeeOptions",
          (o.rows || []).map(r => ({
            ID: r.ID,
            text: r.employeeCode + " " + r.firstName + " " + r.lastName
          })));
      }).catch(() => {
        this.oModel.setProperty("/employeeOptions", []);
      });

      const d = new Date();
      // Default period: the current month (periodFromDate/periodToDate).
      const sFirst = d.toISOString().slice(0, 8) + "01";
      const sLast = new Date(d.getFullYear(), d.getMonth() + 1, 0)
        .toISOString().slice(0, 10);
      this.oModel.setProperty("/draft", {
        employee_ID: "", periodFromDate: sFirst, periodToDate: sLast
      });
      this.oModel.setProperty("/ctError", "");
      if (!this._oDialog) {
        this._oDialog = sap.ui.xmlfragment(
          this.getView().getId(), "ewms.EWMS.view.CreateTimesheetDialog", this);
        this.getView().addDependent(this._oDialog);
      }
      this._oDialog.open();
    },
    onCancelCreate: function () {
      if (this._oDialog) { this._oDialog.close(); }
    },
    onSaveCreate: function () {
      if (this.oModel.getProperty("/ctBusy")) { return; } // one click, one POST
      const m = this.oModel.getProperty("/draft") || {};
      if (!m.employee_ID || !m.periodFromDate || !m.periodToDate) {
        this.oModel.setProperty("/ctError",
          "Employee and both period dates are required.");
        return;
      }
      this.oModel.setProperty("/ctBusy", true);
      this.oModel.setProperty("/ctError", "");
      Backend.createTimesheet({
        employee_ID: m.employee_ID,
        periodFromDate: m.periodFromDate,
        periodToDate: m.periodToDate
      })
        .then(() => {
          this._oDialog.close();
          MessageToast.show("Timesheet created (backend Draft).");
          this._load();
        })
        .catch(oErr => this.oModel.setProperty("/ctError", oErr.message))
        .finally(() => this.oModel.setProperty("/ctBusy", false));
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employees");
    }
  });
});
