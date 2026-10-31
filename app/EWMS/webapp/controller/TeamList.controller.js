sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 27 - Teams list controller.
  // Parent project names are resolved through a restriction-aware
  // project lookup (one round-trip per page); unresolved ids show "—".
  const PAGE_SIZE = 10;

  return Controller.extend("ewms.EWMS.controller.TeamList", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], busy: false,
        error: false, errorText: "",
        pageLabel: "– / –", footerLabel: "",
        skip: 0, total: null, search: ""
      });
      this.getView().setModel(this.oModel, "team");

      this.getOwnerComponent().getRouter().getRoute("teams")
        .attachMatched(this._load, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) { this._load(); }
      else { this._showError("Not signed in — choose a local dev identity in the side panel."); }
    },

    _showError: function (sMsg) {
      this.oModel.setProperty("/error", true);
      this.oModel.setProperty("/errorText", sMsg);
      this.oModel.setProperty("/rows", []);
      this.oModel.setProperty("/total", null);
      this.oModel.setProperty("/footerLabel", "");
      this._updatePaging();
    },

    _load: function () {
      if (!Backend.getSession()) {
        this._showError("Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this.oModel.setProperty("/error", false);
      this.oModel.setProperty("/errorText", "");
      this.oModel.setProperty("/busy", true);
      this.oModel.setProperty("/rows", []);

      Backend.readTeams({
        search: this.oModel.getProperty("/search"),
        top: PAGE_SIZE,
        skip: this.oModel.getProperty("/skip")
      }).then(function (oResult) {
        const aProjIds = [];
        (oResult.rows || []).forEach(function (r) {
          if (r.project_ID && aProjIds.indexOf(r.project_ID) === -1) {
            aProjIds.push(r.project_ID);
          }
        });
        return Backend.refsByName(aProjIds, [])
          .then(function (mRefs) { return { oResult: oResult, mProjects: mRefs.projects }; });
      }.bind(this)).then(function (mJoined) {
        const aRows = (mJoined.oResult.rows || []).map(function (oRow) {
          return Object.assign({}, oRow, {
            projectText: mJoined.mProjects[oRow.project_ID] || "—",
            statusText: Backend.statusLabel(oRow.status)
          });
        });
        this.oModel.setProperty("/rows", aRows);
        this.oModel.setProperty("/total", mJoined.oResult.count);
        this.oModel.setProperty("/footerLabel",
          `Teams visible to your role: ${mJoined.oResult.count} · showing ${aRows.length}`);
        this._updatePaging();
      }.bind(this)).catch(function (oErr) {
        this._showError(oErr.message);
      }.bind(this)).finally(function () {
        this.oModel.setProperty("/busy", false);
      }.bind(this));
    },

    _updatePaging: function () {
      const iTotal = this.oModel.getProperty("/total");
      const iSkip = this.oModel.getProperty("/skip");
      this.oModel.setProperty("/pageLabel", iTotal === null ? "– / –"
        : `${iSkip + 1}–${Math.min(iSkip + PAGE_SIZE, iTotal)} / ${iTotal}`);
      this.byId("btnPrev").setEnabled(iSkip > 0);
      this.byId("btnNext").setEnabled(iTotal !== null && iSkip + PAGE_SIZE < iTotal);
    },

    onSearch: function () {
      this.oModel.setProperty("/search", this.byId("teamSearch").getValue());
      this.oModel.setProperty("/skip", 0);
      this._load();
    },

    onPrevPage: function () {
      this.oModel.setProperty("/skip", Math.max(0, this.oModel.getProperty("/skip") - PAGE_SIZE));
      this._load();
    },

    onNextPage: function () {
      this.oModel.setProperty("/skip", this.oModel.getProperty("/skip") + PAGE_SIZE);
      this._load();
    },

    onTeamPress: function (oEvent) {
      const oRow = oEvent.getSource().getBindingContext("team").getObject();
      this.getOwnerComponent().getRouter().navTo("teamDetail", { id: oRow.ID });
    }
  });
});
