sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 28 - Geo-attendance evidence controller. READ ONLY.
  //
  // What this view deliberately does NOT do:
  //   - it never requests geolocation (the only place coordinates
  //     are captured is the optional toggle inside the Attendance
  //     check-in dialog, on an explicit user action);
  //   - it never claims "verified presence": it shows the backend's
  //     own validation result, distance and reason for each event.
  return Controller.extend("ewms.EWMS.controller.GeoEvidence", {

    onInit: function () {
      this.oModel = new JSONModel({
        events: [], fences: [],
        dateFrom: "", dateTo: "",
        busy: false,
        eventsError: false, eventsErrorText: "",
        fencesError: false, fencesErrorText: ""
      });
      this.getView().setModel(this.oModel, "geo");

      this.getOwnerComponent().getRouter().getRoute("geo")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) { this._onMatched(); }
    },

    _onMatched: function () {
      if (!Backend.getSession()) {
        this.oModel.setProperty("/eventsError", true);
        this.oModel.setProperty("/eventsErrorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this._loadEvents();
      this._loadFences();
    },

    _loadEvents: function () {
      const oM = this.oModel;
      oM.setProperty("/busy", true);
      oM.setProperty("/eventsError", false);

      // Server-side date filters only; backend decides visibility.
      const aF = [];
      const sFrom = oM.getProperty("/dateFrom");
      const sTo = oM.getProperty("/dateTo");
      if (sFrom) { aF.push("eventTimestamp ge " + sFrom); }
      if (sTo) { aF.push("eventTimestamp le " + sTo + "T23:59:59"); }
      // LangConstraint: ev => Backend.readLocationEvents({ filter: ... })
      Backend.readLocationEvents({ filter: aF.join(" and "), top: 100 })
        .then(oR => {
          const aRows = oR.rows || [];
          const asIds = [...new Set(aRows.map(r => r.employee_ID).filter(Boolean))];
          return Backend.readEmployeeMap(asIds).then(mEmp => {
            oM.setProperty("/events", aRows.map(e => ({
              eventTimestamp: Backend.fmtDate(e.eventTimestamp) + " " + Backend.fmtTime(e.eventTimestamp),
              employeeText: mEmp[e.employee_ID] || "—",
              eventTypeText: Backend.label(e.eventType),
              resultText: Backend.label(e.result),
              distanceText: e.distanceMeters == null ? "—" : e.distanceMeters,
              reason: e.reason || "—"
            })));
            oM.setProperty("/eventsError", false);
            oM.setProperty("/busy", false);
          });
        })
        .catch(oErr => {
          oM.setProperty("/events", []);
          oM.setProperty("/eventsError", true);
          oM.setProperty("/eventsErrorText", oErr.message);
          oM.setProperty("/busy", false);
        });
    },

    _loadFences: function () {
      const oM = this.oModel;
      oM.setProperty("/fencesError", false);
      Backend.readGeofences()
        .then(oR => {
          oM.setProperty("/fences", (oR.rows || []).map(g => ({
            geofenceCode: g.geofenceCode || "—",
            name: g.name || "—",
            radiusText: g.radiusMeters == null ? "—" : g.radiusMeters,
            statusText: Backend.label(g.status),
            effectiveFrom: Backend.fmtDate(g.effectiveFrom),
            effectiveTo: Backend.fmtDate(g.effectiveTo)
          })));
        })
        .catch(oErr => {
          oM.setProperty("/fences", []);
          oM.setProperty("/fencesError", true);
          oM.setProperty("/fencesErrorText", oErr.message);
        });
    },

    onFilterChange: function () { this._loadEvents(); },
    onClearFilter: function () {
      this.oModel.setProperty("/dateFrom", "");
      this.oModel.setProperty("/dateTo", "");
      this._loadEvents();
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("attendance");
    }
  });
});
