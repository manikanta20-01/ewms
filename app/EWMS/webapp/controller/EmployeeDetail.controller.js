sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  return Controller.extend("ewms.EWMS.controller.EmployeeDetail", {

    onInit: function () {
      this.oDetail = new JSONModel({
        employee: null, assignments: [],
        statusText: "", joinedText: "",
        busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oDetail, "detail");

      this.getOwnerComponent().getRouter().getRoute("employeeDetail")
        .attachPatternMatched(this._onMatched, this);

      // Identity switch / sign-out while the detail page is open:
      // refetch with the new identity, or show the signed-out state.
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (!this._sEmployeeId) { return; }
      // Replay the load for the currently open employee record with
      // the new identity (same "arguments.id" contract as the router).
      this._onMatched({ getParameter: (sKey) =>
        sKey === "arguments" ? { id: this._sEmployeeId } : undefined });
    },

    _onMatched: function (mArgs) {
      const sId = typeof mArgs.getParameter === "function"
        ? mArgs.getParameter("arguments").id : mArgs.id;
      this._sEmployeeId = sId;
      if (!Backend.getSession()) {
        this.oDetail.setProperty("/error", true);
        this.oDetail.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }

      // Make sure the mid column (list) is populated for column layout
      // coherence also on deep links.
      this.getOwnerComponent().getRouter().getTargets().display("employees");

      this.oDetail.setProperty("/error", false);
      this.oDetail.setProperty("/errorText", "");
      this.oDetail.setProperty("/busy", true);

      Backend.readEmployeeDetail(sId)
        .then(function (oEmployee) {
          // Sprint 27: assignments now reference project/team. CAP does
          // not expose cross-service navigation, so the names are
          // resolved with real (restriction-aware) lookups; unresolved
          // ids stay "—", never invented values.
          const aProjIds = (oEmployee.assignments || [])
            .map(function (a) { return a.project_ID; }).filter(Boolean);
          const aTeamIds = (oEmployee.assignments || [])
            .map(function (a) { return a.team_ID; }).filter(Boolean);
          return Backend.refsByName(aProjIds, aTeamIds)
            .then(function (mRefs) { return { oEmployee: oEmployee, mRefs: mRefs }; });
        }.bind(this))
        .then(function (mLoaded) {
          const oEmployee = mLoaded.oEmployee;
          const oAssignmentLine = function (a, mRefs) {
            const parts = [];
            parts.push("Grade: " + (a.grade?.gradeName ?? "—"));
            if (a.project_ID) {
              parts.push("Project: " + (mRefs.projects[a.project_ID] || "—"));
            }
            if (a.team_ID) {
              parts.push("Team: " + (mRefs.teams[a.team_ID] || "—"));
            }
            parts.push("Reporting manager: " + (a.reportingManager ? `${a.reportingManager.firstName} ${a.reportingManager.lastName}` : "—"));
            parts.push(`From ${Backend.fmtDate(a.fromDate)}`);
            parts.push(a.isActive ? "Active" : "Ended");
            return parts.join(" · ");
          };
          const aAssignments = (oEmployee.assignments || []).map(function (a) {
            return Object.assign({}, a, {
              assignmentLine: oAssignmentLine(a, mLoaded.mRefs)
            });
          });
          this.oDetail.setProperty("/employee", oEmployee);
          this.oDetail.setProperty("/assignments", aAssignments);
          this.oDetail.setProperty("/statusText", Backend.statusLabel(oEmployee.status));
          this.oDetail.setProperty("/joinedText", Backend.fmtDate(oEmployee.joiningDate));
          this.oDetail.setProperty("/error", false);
          this.oDetail.setProperty("/errorText", "");
        }.bind(this))
        .catch(function (oErr) {
          this.oDetail.setProperty("/error", true);
          this.oDetail.setProperty("/errorText", oErr.message);
          this.oDetail.setProperty("/employee", null);
          this.oDetail.setProperty("/assignments", []);
        }.bind(this))
        .finally(function () {
          this.oDetail.setProperty("/busy", false);
        }.bind(this));
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employees");
    }
  });
});
