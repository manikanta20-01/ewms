sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 27 - Team detail controller.
  return Controller.extend("ewms.EWMS.controller.TeamDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        team: null, members: [], membersEmpty: "",
        projectText: "", statusText: "",
        busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oModel, "dTeam");

      this.getOwnerComponent().getRouter().getRoute("teamDetail")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (this._sTeamId && Backend.getSession()) {
        this._load(this._sTeamId);
      }
    },

    _onMatched: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this._sTeamId = sId;
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        this.oModel.setProperty("/team", null);
        this.oModel.setProperty("/members", []);
        return;
      }
      this._load(sId);
    },

    _load: function (sId) {
      const oModel = this.oModel;
      oModel.setProperty("/error", false);
      oModel.setProperty("/errorText", "");
      oModel.setProperty("/busy", true);
      oModel.setProperty("/team", null);
      oModel.setProperty("/members", []);
      oModel.setProperty("/membersEmpty", "");
      oModel.setProperty("/projectText", "");

      // Team record + assignment rows referencing this team (real
      // member list). Independent requests; each shows its own state.
      const oTeamP = Backend.readTeamDetail(sId)
        .catch(function (oErr) { return { error: oErr }; });
      const oMembersP = Backend.readTeamMembers(sId)
        .then(function (o) { return o.rows || []; })
        .catch(function (oErr) { return { error: oErr }; });

      Promise.all([oTeamP, oMembersP]).then(function (aResults) {
        const oTeam = aResults[0];
        const oMembers = aResults[1];

        if (oTeam.error) {
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oTeam.error.message);
          oModel.setProperty("/team", null);
        } else {
          oModel.setProperty("/team", oTeam);
          oModel.setProperty("/statusText", Backend.statusLabel(oTeam.status));

          if (oTeam.project_ID) {
            Backend.refsByName([oTeam.project_ID], []).then(function (mRefs) {
              oModel.setProperty("/projectText", mRefs.projects[oTeam.project_ID] || "—");
            });
          }
        }

        if (oMembers.error) {
          // Real authorization answer (e.g. plain employee gets 403).
          oModel.setProperty("/membersEmpty", "Members unavailable here: " + oMembers.error.message);
          oModel.setProperty("/members", []);
        } else {
          const aItems = oMembers.map(function (a) {
            const sName = a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : "—";
            const sDesig = a.designation ? a.designation.designationName : "—";
            const sState = a.isActive ? "Active" : (Backend.fmtDate(a.toDate) !== "—"
              ? `Ended ${Backend.fmtDate(a.toDate)}` : "Ended");
            return {
              memberTitle: (a.employee ? a.employee.employeeCode + " " : "") + sName,
              memberDescr: `${sDesig} · from ${Backend.fmtDate(a.fromDate)} · ${sState}`,
              ID: a.ID
            };
          });
          oModel.setProperty("/members", aItems);
          oModel.setProperty("/membersEmpty",
            oMembers.length ? "" : "No assignments reference this team");
        }
      }.bind(this)).finally(function () {
        oModel.setProperty("/busy", false);
      });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("teams");
    }
  });
});
