sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Attendance detail. Load -> paint -> actions. Every
  // action calls the REAL backend surface (PATCH check-out, PATCH
  // correction, GET location evidence); backend errors surface as-is.

  return Controller.extend("ewms.EWMS.controller.AttendanceDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        attendanceDate: "", statusText: "", workLocationText: "",
        shiftText: "", checkInText: "", checkOutText: "",
        workedHoursText: "", lateText: "", earlyText: "", remarksText: "",
        geoEvents: [], corrForm: {}, corrError: "", corrBusy: false,
        checkoutBusy: false, busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oModel, "attD");

      this.getOwnerComponent().getRouter().getRoute("attendanceDetail")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (this._sId && Backend.getSession()) { this._load(this._sId); }
    },

    _onMatched: function (oEvent) {
      this._sId = oEvent.getParameter("arguments").id;
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this._load(this._sId);
    },

    _load: function (sId) {
      const oModel = this.oModel;
      oModel.setProperty("/busy", true);
      oModel.setProperty("/error", false);
      oModel.setProperty("/errorText", "");

      // Two real requests; a failure in one does not hide the other.
      Backend.readAttendanceDetail(sId)
        .catch(function (oErr) { return { error: oErr }; })
        .then(function (oAtt) {
          if (oAtt.error) {
            oModel.setProperty("/error", true);
            oModel.setProperty("/errorText", oAtt.error.message);
            oModel.setProperty("/busy", false);
            return;
          }
          oModel.setProperty("/attendanceDate", Backend.fmtDate(oAtt.attendanceDate));
          oModel.setProperty("/statusText", Backend.label(oAtt.attendanceStatus));
          oModel.setProperty("/workLocationText", Backend.label(oAtt.workLocation));
          oModel.setProperty("/shiftText", oAtt.shift
            ? `${oAtt.shift.shiftCode} ${oAtt.shift.name}` : "—");
          oModel.setProperty("/checkInText", Backend.fmtTime(oAtt.checkIn));
          oModel.setProperty("/checkOutText", Backend.fmtTime(oAtt.checkOut));
          oModel.setProperty("/workedHoursText",
            oAtt.workedHours == null ? "—" : String(oAtt.workedHours));
          oModel.setProperty("/lateText",
            oAtt.lateMinutes == null ? "—" : oAtt.lateMinutes + " min");
          oModel.setProperty("/earlyText",
            oAtt.earlyLeavingMinutes == null ? "—" : oAtt.earlyLeavingMinutes + " min");
          oModel.setProperty("/remarksText", oAtt.remarks || "—");
          oModel.setProperty("/busy", false);

          // Pre-fill the correction dialog with the CURRENT values —
          // the user edits a real record, nothing is pre-faked.
          oModel.setProperty("/corrForm", {
            checkIn: oAtt.checkIn ? Backend.fmtTime(oAtt.checkIn) : "",
            checkOut: oAtt.checkOut ? Backend.fmtTime(oAtt.checkOut) : "",
            remarks: oAtt.remarks || ""
          });

          return Backend.readAttendanceLocationEvents(sId)
            .catch(function (oErr) { return { error: oErr }; })
            .then(function (oGeo) {
              if (oGeo.error) {
                // Honest state instead of invented evidence.
                oModel.setProperty("/geoEvents", [{
                  eventTypeText: "—", resultText: "—",
                  distanceText: "—", reason: "Evidence unavailable: " + oGeo.error.message
                }]);
              } else {
                oModel.setProperty("/geoEvents", (oGeo.rows || []).map(function (e) {
                  return {
                    eventTypeText: Backend.label(e.eventType),
                    resultText: Backend.label(e.result),
                    distanceText: e.distanceMeters == null ? "—"
                      : e.distanceMeters + " m",
                    reason: e.reason || "—"
                  };
                }));
              }
            });
        });
    },

    onCheckOut: function () {
      if (this.oModel.getProperty("/checkoutBusy")) { return; }
      const d = new Date();
      const sNow = String(d.getHours()).padStart(2, "0") + ":" +
                   String(d.getMinutes()).padStart(2, "0");
      this.oModel.setProperty("/checkoutBusy", true);
      // Real PATCH of checkOut - the backend computes worked hours.
      Backend.updateAttendance(this._sId, { checkOut: sNow })
        .then(() => {
          MessageToast.show("Check-out recorded by the backend.");
          this._load(this._sId);
        })
        .catch((oErr) => {
          this.oModel.setProperty("/error", true);
          this.oModel.setProperty("/errorText", oErr.message);
        })
        .finally(() => this.oModel.setProperty("/checkoutBusy", false));
    },

    onOpenCorrection: function () { this.byId("attCorrDialog").open(); },
    onCloseCorrection: function () { this.byId("attCorrDialog").close(); },

    onConfirmCorrection: function () {
      if (this.oModel.getProperty("/corrBusy")) { return; }
      const m = this.oModel.getProperty("/corrForm");
      this.oModel.setProperty("/corrError", "");
      this.oModel.setProperty("/corrBusy", true);
      // Whitelisted fields only; duplicate-submission guarded.
      Backend.updateAttendance(this._sId, {
        checkIn: m.checkIn || undefined,
        checkOut: m.checkOut || undefined,
        remarks: m.remarks || undefined
      })
        .then(() => {
          this.byId("attCorrDialog").close();
          MessageToast.show("Correction saved.");
          this._load(this._sId);
        })
        .catch((oErr) => this.oModel.setProperty("/corrError", oErr.message))
        .finally(() => this.oModel.setProperty("/corrBusy", false));
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("attendance");
    }
  });
});
