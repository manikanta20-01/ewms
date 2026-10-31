sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 27 - Project detail controller.
  return Controller.extend("ewms.EWMS.controller.ProjectDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        proj: null, teams: [], teamsEmpty: "",
        deptText: "", statusText: "",
        plannedStartText: "", plannedEndText: "",
        actualStartText: "", actualEndText: "",
        budgetText: "",
        busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oModel, "dProj");

      this.getOwnerComponent().getRouter().getRoute("projectDetail")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (this._sProjectId && Backend.getSession()) {
        this._load(this._sProjectId);
      }
    },

    _onMatched: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this._sProjectId = sId;
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        this.oModel.setProperty("/proj", null);
        this.oModel.setProperty("/teams", []);
        return;
      }
      this._load(sId);
    },

    _load: function (sId) {
      const oModel = this.oModel;
      oModel.setProperty("/error", false);
      oModel.setProperty("/errorText", "");
      oModel.setProperty("/busy", true);
      oModel.setProperty("/proj", null);
      oModel.setProperty("/teams", []);
      oModel.setProperty("/teamsEmpty", "");
      oModel.setProperty("/deptText", "");

      // Project record + the teams whose project_ID references it.
      // Two real backend requests; each part shows its own failure.
      const oProjP = Backend.readProjectDetail(sId)
        .catch(function (oErr) { return { error: oErr }; });
      const oTeamsP = Backend.readTeamsOfProject(sId)
        .then(function (o) { return o.rows || []; })
        .catch(function (oErr) { return { error: oErr }; });

      Promise.all([oProjP, oTeamsP]).then(function (aResults) {
        const oProj = aResults[0];
        const oTeams = aResults[1];

        if (oProj.error) {
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oProj.error.message);
          oModel.setProperty("/proj", null);
        } else {
          oModel.setProperty("/proj", oProj);
          oModel.setProperty("/statusText", Backend.statusLabel(oProj.status));
          oModel.setProperty("/plannedStartText", Backend.fmtDate(oProj.plannedStartDate));
          oModel.setProperty("/plannedEndText", Backend.fmtDate(oProj.plannedEndDate));
          oModel.setProperty("/actualStartText", Backend.fmtDate(oProj.actualStartDate));
          oModel.setProperty("/actualEndText", Backend.fmtDate(oProj.actualEndDate));
          oModel.setProperty("/budgetText",
            oProj.budget === null || oProj.budget === undefined ? "—" : String(oProj.budget));

          if (oProj.department_ID) {
            // Restriction-aware join; empty map -> "—"
            Backend.organizationsByIds([oProj.department_ID]).then(function (mDepts) {
              const sDept = mDepts[oProj.department_ID];
              oModel.setProperty("/deptText", sDept || "—");
            });
          }
        }

        if (oTeams.error) {
          oModel.setProperty("/teamsEmpty", "Teams unavailable here: " + oTeams.error.message);
          oModel.setProperty("/teams", []);
        } else {
          const aItems = oTeams.map(function (t) {
            return {
              teamText: `${t.teamCode} ${t.teamName} · ${Backend.statusLabel(t.status)}`,
              ID: t.ID
            };
          });
          oModel.setProperty("/teams", aItems);
          oModel.setProperty("/teamsEmpty",
            oTeams.length ? "" : "No teams linked to this project");
        }
      }.bind(this)).finally(function () {
        oModel.setProperty("/busy", false);
      });
    },

    onTeamPress: function (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("dProj");
      const sTeamId = oCtx.getObject().ID;
      this.getOwnerComponent().getRouter().navTo("teamDetail", { id: sTeamId });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("projects");
    }
  });
});
