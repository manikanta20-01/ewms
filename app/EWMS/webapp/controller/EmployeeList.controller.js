sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  const PAGE_SIZE = 10;

  return Controller.extend("ewms.EWMS.controller.EmployeeList", {

    onInit: function () {
      this.oEmp = new JSONModel({
        rows: [],
        busy: false,
        error: false, errorText: "",
        pageLabel: "– / –",
        footerLabel: "",
        skip: 0,
        total: null,
        search: "",
        // Sprint 27 - serverside filter picks ("" = no filter).
        selEmploymentType: "",
        selStatus: ""
      });
      this.getView().setModel(this.oEmp, "emp");

      this.getOwnerComponent().getRouter().getRoute("employees").attachMatched(this._load, this);
      // Also reload when the target is displayed programmatically
      // (deep link to a detail page also shows this list page).
      this.getOwnerComponent().getRouter().getTarget("employees")
        .attachDisplay(this._load, this);

      // Identity switch / sign-out while this page is open:
      // re-fetch (or clear) the role-scoped data.
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (Backend.getSession()) {
        this._load();
      } else {
        this.oEmp.setProperty("/error", true);
        this.oEmp.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        this.oEmp.setProperty("/rows", []);
        this.oEmp.setProperty("/total", null);
        this.oEmp.setProperty("/footerLabel", "");
        this._updatePaging();
      }
    },

    _load: function () {
      if (!Backend.getSession()) {
        this.oEmp.setProperty("/error", true);
        this.oEmp.setProperty("/errorText", "Not signed in — choose a local dev identity in the side panel.");
        this.oEmp.setProperty("/rows", []);
        this._updatePaging();
        return;
      }
      this.oEmp.setProperty("/error", false);
      this.oEmp.setProperty("/errorText", "");
      this.oEmp.setProperty("/busy", true);
      this.oEmp.setProperty("/rows", []);

      Backend.readEmployees({
        search: this.oEmp.getProperty("/search"),
        employmentType: this.oEmp.getProperty("/selEmploymentType"),
        status: this.oEmp.getProperty("/selStatus"),
        top: PAGE_SIZE,
        skip: this.oEmp.getProperty("/skip")
      }).then(function (oResult) {
        const aRows = oResult.rows.map(function (oRow) {
          return Object.assign({}, oRow, { statusText: Backend.statusLabel(oRow.status) });
        });
        this.oEmp.setProperty("/rows", aRows);
        this.oEmp.setProperty("/total", oResult.count);
        this.oEmp.setProperty("/footerLabel",
          `Records visible to your role: ${oResult.count} · showing ${aRows.length}`);
        this.oEmp.setProperty("/error", false);
        this.oEmp.setProperty("/errorText", "");
        this._updatePaging();
      }.bind(this)).catch(function (oErr) {
        // honest error state — no fake rows substituted
        this.oEmp.setProperty("/error", true);
        this.oEmp.setProperty("/errorText", oErr.message);
        this.oEmp.setProperty("/rows", []);
        this.oEmp.setProperty("/total", null);
        this.oEmp.setProperty("/footerLabel", "");
        this._updatePaging();
      }.bind(this)).finally(function () {
        this.oEmp.setProperty("/busy", false);
      }.bind(this));
    },

    _updatePaging: function () {
      const iTotal = this.oEmp.getProperty("/total");
      const iSkip = this.oEmp.getProperty("/skip");
      this.oEmp.setProperty("/pageLabel", iTotal === null ? "– / –"
        : `${iSkip + 1}–${Math.min(iSkip + PAGE_SIZE, iTotal)} / ${iTotal}`);
      this.byId("btnPrev").setEnabled(iSkip > 0);
      this.byId("btnNext").setEnabled(iTotal !== null && iSkip + PAGE_SIZE < iTotal);
    },

    // Sprint 27 - employment type / status dropdown filters; the
    // filter runs as $filter on the backend (role scoping intact).
    onFilterChange: function () {
      this.oEmp.setProperty("/selEmploymentType", this.byId("selEmploymentType").getSelectedKey());
      this.oEmp.setProperty("/selStatus", this.byId("selStatus").getSelectedKey());
      this.oEmp.setProperty("/skip", 0);
      this._load();
    },

    onSearch: function () {
      this.oEmp.setProperty("/search", this.byId("empSearch").getValue());
      this.oEmp.setProperty("/skip", 0); // new search resets to first page
      this._load();
    },

    onPrevPage: function () {
      this.oEmp.setProperty("/skip", Math.max(0, this.oEmp.getProperty("/skip") - PAGE_SIZE));
      this._load();
    },

    onNextPage: function () {
      this.oEmp.setProperty("/skip", this.oEmp.getProperty("/skip") + PAGE_SIZE);
      this._load();
    },

    onEmployeePress: function (oEvent) {
      const oRow = oEvent.getSource().getBindingContext("emp").getObject();
      this.getOwnerComponent().getRouter()
        .navTo("employeeDetail", { id: oRow.ID });
    }
  });
});
