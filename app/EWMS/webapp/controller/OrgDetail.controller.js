sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, Backend) {
  "use strict";

  // Sprint 27 - Department detail controller.
  return Controller.extend("ewms.EWMS.controller.OrgDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        dept: null, projects: [], projectsEmpty: "",
        buText: "", locText: "", statusText: "",
        busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oModel, "dOrg");

      this.getOwnerComponent().getRouter().getRoute("orgDetail")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (this._sDeptId && Backend.getSession()) {
        this._load(this._sDeptId);
      }
    },

    _onMatched: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this._sDeptId = sId;
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        this.oModel.setProperty("/dept", null);
        this.oModel.setProperty("/projects", []);
        return;
      }
      this._load(sId);
    },

    _load: function (sId) {
      const oModel = this.oModel;
      oModel.setProperty("/error", false);
      oModel.setProperty("/errorText", "");
      oModel.setProperty("/busy", true);
      oModel.setProperty("/dept", null);
      oModel.setProperty("/projects", []);
      oModel.setProperty("/projectsEmpty", "");
      oModel.setProperty("/buText", "");
      oModel.setProperty("/locText", "");

      // Two independent, real requests: the department record (HR
      // roles only) and the projects linked to it via department_ID.
      // A failure on one part shows that part's real error and does
      // not block the other.
      const oDeptP = Backend.readDepartmentDetail(sId)
        .catch(function (oErr) { return { error: oErr }; });
      const oProjP = Backend.readProjectsOfDepartment(sId)
        .then(function (o) { return o.rows || []; })
        .catch(function (oErr) { return { error: oErr }; });

      Promise.all([oDeptP, oProjP]).then(function (aResults) {
        const oDept = aResults[0];
        const oProjects = aResults[1];

        if (oDept.error) {
          oModel.setProperty("/error", true);
          oModel.setProperty("/errorText", oDept.error.message);
          oModel.setProperty("/dept", null);
        } else {
          const oD = oDept;
          oModel.setProperty("/dept", oD);
          oModel.setProperty("/statusText", Backend.statusLabel(oD.status));
          oModel.setProperty("/buText", oD.businessUnit
            ? `${oD.businessUnit.businessUnitCode} ${oD.businessUnit.businessUnitName}`
            : "—");
          oModel.setProperty("/locText", oD.location
            ? `${oD.location.locationCode} ${oD.location.locationName}` +
              (oD.location.city ? ` (${oD.location.city})` : "")
            : "—");
        }

        if (oProjects.error) {
          // Honest: the role cannot read project data or the request failed.
          oModel.setProperty("/projectsEmpty", "Projects unavailable here: " + oProjects.error.message);
          oModel.setProperty("/projects", []);
        } else {
          const aLines = oProjects.map(function (p) {
            return `${p.projectCode} ${p.projectName} · ${p.clientName || "—"} · ${Backend.statusLabel(p.status)}`;
          });
          oModel.setProperty("/projects", aLines.map(function (t, i) {
            return { projectLine: t, ID: oProjects[i].ID };
          }));
          oModel.setProperty("/projectsEmpty",
            oProjects.length ? "" : "No projects linked to this department");
        }
      }.bind(this)).finally(function () {
        oModel.setProperty("/busy", false);
      });
    },

    onProjectPress: function (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("dOrg");
      const sProjectId = oCtx.getObject().ID;
      this.getOwnerComponent().getRouter().navTo("projectDetail", { id: sProjectId });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("org");
    }
  });
});
