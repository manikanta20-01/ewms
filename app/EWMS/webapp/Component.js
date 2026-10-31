sap.ui.define([
  "sap/ui/core/UIComponent",
  "ewms/EWMS/model/Backend",
  "ewms/EWMS/model/Config",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, Backend, Config, JSONModel) {
  "use strict";

  return UIComponent.extend("ewms.EWMS.Component", {

    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncComponent"]
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      this.setModel(Config.getModel(), "backend-config");

      const oAppModel = new JSONModel({
        user: null,
        layout: "OneColumn",
        selectedUser: null,
        nav: Config.getModel().getProperty("/nav"),
        mockUsers: Backend.getMockUsers()
      });
      this.setModel(oAppModel, "app");

      // Restore the previous local dev session, if any. This is the
      // dev-only "who am I" pick (CAP mocked users), NOT a security feature:
      // every request still carries the backend authorization check.
      Backend.restore();
      this.getModel("app").setProperty("/user", Backend.getSession() ? Backend.getSession().user : null);

      this.getRouter().initialize();
    },

    signInAs: function (sUserId) {
      const oUser = Backend.signIn(sUserId);
      this.getModel("app").setProperty("/user", oUser);
      // Views holding role-scoped data re-fetch when the identity
      // changes (sap.ui.getCore().getEventBus() channel "ewms").
      sap.ui.getCore().getEventBus().publish("ewms", "sessionChanged", {});
    },

    signOut: function () {
      Backend.signOut();
      this.getModel("app").setProperty("/user", null);
      sap.ui.getCore().getEventBus().publish("ewms", "sessionChanged", {});
      this.getRouter().navTo("home", {}, true);
    }
  });
});
