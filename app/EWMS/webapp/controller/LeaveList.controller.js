sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Leave list. Apply = REAL POST to LeaveRequests; the
  // backend validates overlap, computes leaveNumber / totalDays and
  // seeds the multi-level approval rows. Nothing here pre-computes.

  return Controller.extend("ewms.EWMS.controller.LeaveList", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], pageLabel: "",
        filterStatus: "",
        busy: false, error: false, errorText: "",
        leaveTypes: [], employeeOptions: [],
        applyForm: {}, applyError: "", applyBusy: false
      });
      this.getView().setModel(this.oModel, "lv");

      this.getOwnerComponent().getRouter().getRoute("leave")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) { this._load(); }
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
      oModel.setProperty("/errorText", "");

      const sStatus = oModel.getProperty("/filterStatus");
      const sFilter = sStatus ? `status eq '${sStatus}'` : "";

      Backend.readLeaveRequests({ top: 50, filter: sFilter })
        .then((oResult) => {
          const aRows = (oResult.rows || []).map(r => ({
            ID: r.ID,
            leaveNumber: r.leaveNumber || "—",
            typeText: r.leaveType ? `${r.leaveType.leaveCode}` : "—",
            fromDate: Backend.fmtDate(r.fromDate),
            toDate: Backend.fmtDate(r.toDate),
            totalDays: r.totalDays == null ? "—" : String(r.totalDays),
            statusText: Backend.label(r.status)
          }));
          oModel.setProperty("/rows", aRows);
          oModel.setProperty("/pageLabel",
            "Leave requests visible to your role: " +
            (oResult.count == null ? aRows.length : oResult.count));
        })
        .catch((oErr) => {
          oModel.setProperty("/rows", []);
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oErr.message);
          oModel.setProperty("/pageLabel", "");
        })
        .finally(() => oModel.setProperty("/busy", false));
    },

    onFilterChange: function () { this._load(); },

    onOpenApply: function () {
      // Leave types (readable by every signed-in role) and the
      // directory (scope = role) feed the REAL backend validation.
      Backend.readLeaveTypes()
        .then((o) => this.oModel.setProperty("/leaveTypes", (o.rows || []).map(t => ({
          ID: t.ID, text: `${t.leaveCode} ${t.name}${t.isPaid ? " (paid)" : ""}`
        }))))
        .catch(() => this.oModel.setProperty("/leaveTypes", []));
      Backend.readEmployees({ top: 50 })
        .then((o) => this.oModel.setProperty("/employeeOptions",
          (o.rows || []).map(r => ({
            ID: r.ID, text: r.employeeCode + " " + r.firstName + " " + r.lastName
          }))))
        .catch(() => this.oModel.setProperty("/employeeOptions", []));
      const d = new Date();
      this.oModel.setProperty("/applyForm", {
        employee_ID: "", leaveType_ID: "",
        fromDate: d.toISOString().slice(0, 10),
        toDate: d.toISOString().slice(0, 10),
        halfDay: false, halfDayType: "FirstHalf", reason: "", emergency: false
      });
      this.oModel.setProperty("/applyError", "");
      if (!this._oDialog) {
        this._oDialog = sap.ui.xmlfragment(
          this.getView().getId(), "ewms.EWMS.view.ApplyLeaveDialog", this);
        this.getView().addDependent(this._oDialog);
      }
      this._oDialog.open();
    },

    onCloseApply: function () { if (this._oDialog) { this._oDialog.close(); } },

    onConfirmApply: function () {
      if (this.oModel.getProperty("/applyBusy")) { return; } // one click, one request
      const m = this.oModel.getProperty("/applyForm");
      this.oModel.setProperty("/applyError", "");
      if (!m.employee_ID || !m.leaveType_ID || !m.fromDate || !m.toDate || !m.reason) {
        this.oModel.setProperty("/applyError",
          "Employee, leave type, dates and reason are required.");
        return;
      }
      this.oModel.setProperty("/applyBusy", true);
      // Only the fields the backend CREATE handler reads; totalDays,
      // status, appliedOn and leaveNumber are computed server-side.
      Backend.createLeaveRequest({
        employee_ID: m.employee_ID,
        leaveType_ID: m.leaveType_ID,
        fromDate: m.fromDate,
        toDate: m.halfDay ? m.fromDate : m.toDate,
        halfDay: !!m.halfDay,
        halfDayType: m.halfDay ? m.halfDayType : undefined,
        emergencyLeave: !!m.emergency,
        reason: m.reason
      })
        .then(() => {
          this._oDialog.close();
          MessageToast.show("Leave request filed with the backend.");
          this._load();
        })
        .catch((oErr) => this.oModel.setProperty("/applyError", oErr.message))
        .finally(() => this.oModel.setProperty("/applyBusy", false));
    },

    onRowPress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext("lv").getObject().ID;
      this.getOwnerComponent().getRouter().navTo("leaveDetail", { id: sId });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employees");
    }
  });
});
