sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast"
], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("ewms.EWMS.controller.Main", {

    oLayout: null,

    onInit: function () {
      this.oRouter = this.getOwnerComponent().getRouter();
      this.oRouter.attachRouteMatched(this.onRouteMatched, this);
    },

    onRouteMatched: function (oEvent) {
      const sRouteName = oEvent.getParameter("name");
      const oFcl = this.byId("fcl");
      let sLayout;

      // Column semantics: begin = navigation menu, mid = list pages,
      // end = detail pages.
      if (sRouteName === "employeeDetail" || sRouteName === "orgDetail" ||
          sRouteName === "projectDetail" || sRouteName === "teamDetail" ||
          sRouteName === "attendanceDetail" || sRouteName === "leaveDetail" ||
          sRouteName === "timesheetDetail" || sRouteName === "shiftDetail" ||
          sRouteName === "geoDetail") {
        sLayout = "ThreeColumnsMidExpanded";
      } else {
        sLayout = "TwoColumnsBeginExpanded";
      }

      if (oFcl) {
        oFcl.setLayout(sLayout);
      }
      this.getOwnerComponent().getModel("app").setProperty("/layout", sLayout);
      this._selectMenu(sRouteName);
    },

    _selectMenu: function (sRouteName) {
      const oList = this.byId("navList");
      const aItems = oList.getItems();
      // The Employee module is today's working screen; the other modules
      // stay unselected until their sprints land.
      aItems.forEach(function (oItem) {
        oItem.setSelected(false);
      });
      // Route -> nav menu key (all detail routes highlight their list
      // module, so the menu always shows where the user is).
      const mRouteToKey = {
        employees: "employees", employeeDetail: "employees",
        org: "org", orgDetail: "org",
        projects: "projects", projectDetail: "projects",
        teams: "teams", teamDetail: "teams",
        // Sprint 28 modules highlight their menu entry from both
        // list and detail routes.
        attendance: "attendance", attendanceDetail: "attendance",
        leave: "leave", leaveDetail: "leave",
        timesheets: "timesheet", timesheetDetail: "timesheet",
        shifts: "shifts",
        geo: "geo"
      };
      const sMenuKey = mRouteToKey[sRouteName];
      if (sMenuKey) {
        aItems.forEach(function (oItem) {
          if (oItem.getBindingContext("app").getObject().key === sMenuKey) {
            oItem.setSelected(true);
          }
        });
      }
    },

    onNavItemPress: function (oEvent) {
      const oNav = oEvent.getSource().getBindingContext("app").getObject();
      if (!oNav.available || !oNav.route) {
        // Deliberate: not a broken link, an honest "not built yet".
        MessageToast.show(`"${oNav.title}" is planned for a later sprint.`);
        return;
      }
      this.oRouter.navTo(oNav.route);
    },

    onSignIn: function () {
      const sUser = this.byId("userCombo").getSelectedKey();
      if (!sUser) {
        MessageToast.show("Pick a local dev user first.");
        return;
      }
      const oComponent = this.getOwnerComponent();
      oComponent.signInAs(sUser);
      MessageToast.show(`Signed in locally as ${sUser}.`);
      // Jump straight to the working module so real data is visible.
      this.oRouter.navTo("employees");
    },

    onSignOut: function () {
      this.getOwnerComponent().signOut();
      MessageToast.show("Signed out.");
    }
  });
});
