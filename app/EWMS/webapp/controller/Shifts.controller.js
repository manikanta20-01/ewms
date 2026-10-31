sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 28 - Shifts & roster. Four independent, real READS. Each
  // area carries its own loading/empty/error state - one failing
  // area never poisons the others. (A local read failure is filtered
  // out of empty-labels checks.) No inventing rows anywhere.

  return Controller.extend("ewms.EWMS.controller.Shifts", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], assignments: [], schedules: [], holidays: [],
        schedDate: "",
        busy: false,
        shiftsError: false, shiftsErrorText: "",
        assignError: false, assignErrorText: "",
        schedError: false, schedErrorText: "",
        holidayError: false, holidayErrorText: ""
      });
      this.getView().setModel(this.oModel, "shf");

      this.getOwnerComponent().getRouter().getRoute("shifts")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) { this._loadShifts(); this._loadAssignments(); this._loadSchedules(); this._loadHolidays(); }
    },

    _onMatched: function () {
      if (!Backend.getSession()) {
        this.oModel.setProperty("/shiftsError", true);
        this.oModel.setProperty("/shiftsErrorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this._loadShifts();
      this._loadAssignments();
      this._loadSchedules();
      this._loadHolidays();
    },

    _loadShifts: function () {
      Backend.readShifts()
        .then(o => this.oModel.setProperty("/rows", (o.rows || []).map(s => ({
          ID: s.ID, shiftCode: s.shiftCode || "—", name: s.name || "—",
          startTime: Backend.fmtTime(s.startTime),
          endTime: Backend.fmtTime(s.endTime),
          graceIn: (s.graceInMinutes || 0) + " min",
          graceOut: (s.graceOutMinutes || 0) + " min",
          breakMin: (s.breakMinutes || 0) + " min",
          nightShift: s.nightShift ? "Yes" : "No",
          statusText: Backend.label(s.status)
        }))))
        .catch(oErr => {
          this.oModel.setProperty("/rows", []);
          this.oModel.setProperty("/shiftsError", true);
          this.oModel.setProperty("/shiftsErrorText", oErr.message);
        });
    },

    _loadAssignments: function () {
      Backend.readShiftAssignments()
        .then(o => {
          const a = o.rows || [];
          const asIds = [...new Set(a.map(x => x.employee_ID).filter(Boolean))];
          return Backend.readEmployeeMap(asIds).then(mEmp => {
            this.oModel.setProperty("/assignments", a.map(x => ({
              employeeText: mEmp[x.employee_ID] || "—",
              shiftText: x.shift ? `${x.shift.shiftCode} ${x.shift.name}` : "—",
              effectiveFrom: Backend.fmtDate(x.effectiveFrom),
              effectiveTo: Backend.fmtDate(x.effectiveTo)
            })));
          });
        })
        .catch(oErr => {
          this.oModel.setProperty("/assignments", []);
          this.oModel.setProperty("/assignError", true);
          this.oModel.setProperty("/assignErrorText", oErr.message);
        });
    },

    _loadSchedules: function () {
      const sDate = this.oModel.getProperty("/schedDate");
      const sFilter = sDate ? "scheduleDate eq " + sDate : "";
      Backend.readWorkSchedules(sFilter)
        .then(o => {
          const a = o.rows || [];
          const asIds = [...new Set(a.map(x => x.employee_ID).filter(Boolean))];
          return Backend.readEmployeeMap(asIds).then(mEmp => {
            this.oModel.setProperty("/schedules", a.map(x => ({
              scheduleDate: Backend.fmtDate(x.scheduleDate),
              employeeText: mEmp[x.employee_ID] || "—",
              shiftText: x.shift ? `${x.shift.shiftCode} ${x.shift.name}` : "—",
              remarks: x.remarks || "—"
            })));
          });
        })
        .catch(oErr => {
          this.oModel.setProperty("/schedules", []);
          this.oModel.setProperty("/schedError", true);
          this.oModel.setProperty("/schedErrorText", oErr.message);
        });
    },

    _loadHolidays: function () {
      Backend.readHolidays()
        .then(o => this.oModel.setProperty("/holidays", (o.rows || []).map(h => ({
          name: h.holidayName || "—",
          date: Backend.fmtDate(h.date),
          description: h.description || "—"
        }))))
        .catch(oErr => {
          this.oModel.setProperty("/holidays", []);
          this.oModel.setProperty("/holidayError", true);
          this.oModel.setProperty("/holidayErrorText", oErr.message);
        });
    },

    onRefresh: function () {
      this._loadShifts();
      this._loadAssignments();
      this._loadSchedules();
      this._loadHolidays();
    },

    onSchedDateChange: function () { this._loadSchedules(); },
    onClearSchedDate: function () {
      this.oModel.setProperty("/schedDate", "");
      this._loadSchedules();
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employees");
    }
  });
});
