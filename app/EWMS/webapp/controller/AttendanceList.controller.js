sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Attendance list controller.
  //
  // The backend decides what "my attendance" means: a plain employee
  // sees only their own rows (where-clause on the service), managers
  // their department scope, HR everything. The UI never widens that.
  // Check-in is a REAL POST (srv/attendance/handlers resolves the
  // shift, computes late minutes and runs the geofence validation).

  function _nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" +
           String(d.getMinutes()).padStart(2, "0");
  }

  return Controller.extend("ewms.EWMS.controller.AttendanceList", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], count: null,
        filterDateFrom: "", filterDateTo: "", filterStatus: "",
        busy: false, error: false, errorText: "",
        pageLabel: "",
        employeeOptions: [], ciBusy: false, ciError: "",
        statusOptions: [
          { key: "Present", text: "Present" },
          { key: "Absent", text: "Absent" },
          { key: "HalfDay", text: "Half day" },
          { key: "Leave", text: "Leave" },
          { key: "Holiday", text: "Holiday" },
          { key: "WeekOff", text: "Week off" },
          { key: "WorkFromHome", text: "Work from home" },
          { key: "OnDuty", text: "On duty" }
        ]
      });
      this.getView().setModel(this.oModel, "att");

      this.getOwnerComponent().getRouter().getRoute("attendance")
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

      // Server-side filters only: the backend decides visibility
      // and filtering; the UI never fakes rows it should not see.
      const aFilters = [];
      const sFrom = oModel.getProperty("/filterDateFrom");
      const sTo = oModel.getProperty("/filterDateTo");
      const sStatus = oModel.getProperty("/filterStatus");
      if (sFrom) { aFilters.push("attendanceDate ge " + sFrom); }
      if (sTo) { aFilters.push("attendanceDate le " + sTo); }
      if (sStatus) { aFilters.push(`attendanceStatus eq '${sStatus}'`); }
      const sFilter = aFilters.join(" and ");

      Backend.readAttendances({ top: 50, filter: sFilter })
        .then((oResult) => this._paintRows(oResult))
        .catch((oErr) => {
          oModel.setProperty("/rows", []);
          oModel.setProperty("/count", null);
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oErr.message);
          oModel.setProperty("/pageLabel", "");
        })
        .finally(() => oModel.setProperty("/busy", false));
    },

    // Rows + employee names joined client-side (cross-service).
    _paintRows: function (oResult) {
      const aRows = oResult.rows || [];
      const asEmployeeIds = [...new Set(aRows.map(r => r.employee_ID).filter(Boolean))];
      return Backend.readEmployeeMap(asEmployeeIds).then((mEmp) => {
        this.oModel.setProperty("/rows", aRows.map(r => ({
          ID: r.ID,
          attendanceDate: Backend.fmtDate(r.attendanceDate),
          employeeText: mEmp[r.employee_ID] || "—",
          statusText: Backend.label(r.attendanceStatus),
          checkIn: Backend.fmtTime(r.checkIn),
          checkOut: Backend.fmtTime(r.checkOut),
          workLocation: Backend.label(r.workLocation),
          lateMinutes: r.lateMinutes == null ? "—" : r.lateMinutes + " min"
        })));
        this.oModel.setProperty("/count", oResult.count);
        this.oModel.setProperty("/pageLabel",
          "Attendance visible to your role: " +
          (oResult.count == null ? aRows.length : oResult.count));
      });
    },

    onFilterChange: function () { this._load(); },

    onOpenCheckIn: function () {
      // The dialog reuses the REAL employee directory: a plain
      // employee sees only their own row there, so the picker
      // automatically matches what the backend will accept.
      if (!this._oEmployeeOptions) {
        Backend.readEmployees({ top: 50 }).then((o) => {
          this._oEmployeeOptions = (o.rows || []).map(r => ({
            ID: r.ID,
            text: r.employeeCode + " " + r.firstName + " " + r.lastName
          }));
          this.oModel.setProperty("/employeeOptions", this._oEmployeeOptions);
        }).catch(() => {
          this.oModel.setProperty("/employeeOptions", []);
        });
      } else {
        this.oModel.setProperty("/employeeOptions", this._oEmployeeOptions);
      }
      const d = new Date();
      this.oModel.setProperty("/ciForm", {
        employee_ID: "",
        attendanceDate: d.toISOString().slice(0, 10),
        checkIn: _nowTime(),
        workLocation: "Office",
        useLocation: false
      });
      this.oModel.setProperty("/ciError", "");
      if (!this._oDialog) {
        this._oDialog = sap.ui.xmlfragment(
          this.getView().getId(), "ewms.EWMS.view.CheckInDialog", this);
        this.getView().addDependent(this._oDialog);
      }
      this._oDialog.open();
    },

    onCloseCheckIn: function () { if (this._oDialog) { this._oDialog.close(); } },

    onCheckInLocationToggle: function () {
      // Location is only requested when the employee opts in for
      // THIS check-in. No background tracking of any kind.
      this.oModel.setProperty("/ciForm/useLocation",
        !this.oModel.getProperty("/ciForm/useLocation"));
    },

    onConfirmCheckIn: function () {
      const m = this.oModel.getProperty("/ciForm");
      this.oModel.setProperty("/ciError", "");
      if (!m.employee_ID || !m.attendanceDate || !m.checkIn) {
        this.oModel.setProperty("/ciError",
          "Employee, date and check-in time are required.");
        return;
      }
      // Duplicate-submission guard: one in-flight request per click.
      if (this.oModel.getProperty("/ciBusy")) { return; }
      this.oModel.setProperty("/ciBusy", true);

      const finish = (mPayload) =>
        Backend.createAttendance(mPayload)
          .then(() => {
            this._oDialog.close();
            MessageToast.show("Check-in recorded by the backend.");
            this._load();
          })
          .catch((oErr) =>
            this.oModel.setProperty("/ciError", oErr.message))
          .finally(() => this.oModel.setProperty("/ciBusy", false));

      if (!m.useLocation) {
        finish({
          employee_ID: m.employee_ID,
          attendanceDate: m.attendanceDate,
          checkIn: m.checkIn,
          workLocation: m.workLocation
        });
        return;
      }
      // Optional geolocation: ONLY on this explicit user action.
      // Failure is explained in the dialog; the request is not sent
      // with zero coordinates pretending they were verified.
      if (!navigator.geolocation) {
        this.oModel.setProperty("/ciError",
          "Location is not available in this browser. Uncheck 'include location' to continue without coordinates.");
        this.oModel.setProperty("/ciBusy", false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (oPos) => finish({
          employee_ID: m.employee_ID,
          attendanceDate: m.attendanceDate,
          checkIn: m.checkIn,
          workLocation: m.workLocation,
          latitude: oPos.coords.latitude,
          longitude: oPos.coords.longitude,
          locationTimestamp: new Date(oPos.timestamp).toISOString()
        }),
        (oErr) => {
          const sWhy = oErr.code === 1
            ? "Permission denied — allow location access for this site to use geofence check-in."
            : (oErr.code === 2 ? "Location unavailable." : "Location timed out.");
          this.oModel.setProperty("/ciError", sWhy);
          this.oModel.setProperty("/ciBusy", false);
        },
        { timeout: 10000 }
      );
    },

    onRowPress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext("att").getObject().ID;
      this.getOwnerComponent().getRouter().navTo("attendanceDetail", { id: sId });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employees");
    }
  });
});
