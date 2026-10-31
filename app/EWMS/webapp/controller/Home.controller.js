sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  return Controller.extend("ewms.EWMS.controller.Home", {

    onInit: function () {
      this.oHome = new JSONModel({
        connText: "—", empCountText: "—", error: false, errorText: "",
        signedIn: false
      });
      this.getView().setModel(this.oHome, "home");
      this.getOwnerComponent().getRouter().getRoute("home").attachMatched(this._refresh, this);
    },

    _refresh: function () {
      const oUser = Backend.getSession();
      this.oHome.setProperty("/signedIn", !!oUser);
      if (!oUser) {
        this.oHome.setProperty("/connText", "Not signed in. Use the side panel to pick a local dev identity.");
        this.oHome.setProperty("/empCountText", "—");
        this.oHome.setProperty("/error", false);
        this.oHome.setProperty("/errorText", "");
        return;
      }
      this.oHome.setProperty("/connText", "Signed in, checking backend…");
      Backend.readEmployeesCount()
        .then(function (iCount) {
          this.oHome.setProperty("/connText", `Connected (EmployeeService).
Local dev identity: ${oUser.user.label}.`);
          this.oHome.setProperty("/empCountText",
            `Employee records visible to you: ${iCount} (role-scoped by the backend).`);
          this.oHome.setProperty("/error", false);
          this.oHome.setProperty("/errorText", "");
        }.bind(this))
        .catch(function (oErr) {
          this.oHome.setProperty("/connText", "Backend check failed");
          this.oHome.setProperty("/empCountText", "—");
          this.oHome.setProperty("/error", true);
          this.oHome.setProperty("/errorText", oErr.message);
        }.bind(this));
    },

    onCheckConnection: function () {
      this._refresh();
    }
  });
});
