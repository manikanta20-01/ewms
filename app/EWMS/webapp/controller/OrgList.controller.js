sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 27 - Departments list controller. Shared shape with the
  // other list controllers (busy/error/paging) from Sprint 26 so the
  // behavior stays consistent across screens without a custom base
  // class (standard controls + same conventions, no new framework).
  const PAGE_SIZE = 10;

  return Controller.extend("ewms.EWMS.controller.OrgList", {

    onInit: function () {
      this.oModel = new JSONModel({
        rows: [], busy: false,
        error: false, errorText: "",
        pageLabel: "– / –", footerLabel: "",
        skip: 0, total: null, search: ""
      });
      this.getView().setModel(this.oModel, "org");

      this.getOwnerComponent().getRouter().getRoute("org")
        .attachMatched(this._load, this);
      // Identity switch / sign-out while the page is open: re-fetch
      // with the new role's visibility (backend decides the rows).
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

      Backend.readDepartments({
        search: this.oModel.getProperty("/search"),
        top: PAGE_SIZE,
        skip: this.oModel.getProperty("/skip")
      }).then(function (oResult) {
        const aRows = (oResult.rows || []).map(function (oRow) {
          return Object.assign({}, oRow, {
            businessUnitName: oRow.businessUnit ? oRow.businessUnit.businessUnitName : "",
            locationName: oRow.location ? oRow.location.locationName : "",
            statusText: Backend.statusLabel(oRow.status)
          });
        });
        this.oModel.setProperty("/rows", aRows);
        this.oModel.setProperty("/total", oResult.count);
        this.oModel.setProperty("/footerLabel",
          `Departments visible to your role: ${oResult.count} · showing ${aRows.length}`);
        this._updatePaging();
      }.bind(this)).catch(function (oErr) {
        // Real backend answer (e.g. 403 for non-HR roles) — shown, not hidden.
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
      this.oModel.setProperty("/search", this.byId("orgSearch").getValue());
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

    onDepartmentPress: function (oEvent) {
      const oRow = oEvent.getSource().getBindingContext("org").getObject();
      this.getOwnerComponent().getRouter().navTo("orgDetail", { id: oRow.ID });
    }
  });
});
