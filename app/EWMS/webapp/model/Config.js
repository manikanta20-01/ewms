sap.ui.define(["sap/ui/model/json/JSONModel"], function (JSONModel) {
  "use strict";

  // ------------------------------------------------------------
  // Static shell configuration. Deliberately minimal: a service
  // registry (what the backend exposes, relative same-origin paths)
  // and the module navigation. NO business data lives here —
  // every number the UI shows comes from a real OData response,
  // and if a request fails the UI shows the error state instead
  // of substituting fake values.
  // ------------------------------------------------------------

  const oConfig = {
    // Relative paths keep the app portable: locally CAP serves the
    // app and the OData services on the same origin (no proxy
    // needed); in a future approuter/managed-approuter production
    // setup the same relative paths are routed by the approuter.
    services: {
      employee: "/odata/v4/employee/",
      organization: "/odata/v4/organization/",
      project: "/odata/v4/project/",
      team: "/odata/v4/team/",
      // Sprint 28 - attendance domain services (real CAP paths, same
      // service names the backend registers in srv/services.cds).
      attendance: "/odata/v4/attendance/",
      leave: "/odata/v4/leave/",
      timesheet: "/odata/v4/timesheet/",
      geo: "/odata/v4/geo/"
    },

    nav: [
      {
        key: "employees",
        title: "Employee Directory",
        icon: "sap-icon://employee",
        route: "employees",
        available: true,
        info: "Browse profiles",
        badgeType: "Success"
      },
      {
        key: "org",
        title: "Organization",
        icon: "sap-icon://building",
        route: "org",
        available: true,
        info: "Departments (HR roles)",
        badgeType: "Success"
      },
      {
        key: "projects",
        title: "Projects",
        icon: "sap-icon://folder",
        route: "projects",
        available: true,
        info: "Browse & team lookup",
        badgeType: "Success"
      },
      {
        key: "teams",
        title: "Teams",
        icon: "sap-icon://group",
        route: "teams",
        available: true,
        info: "Browse & members (HR/manager roles)",
        badgeType: "Success"
      },
      {
        key: "attendance",
        title: "Attendance",
        icon: "sap-icon://clock-in",
        route: "attendance",
        available: true,
        info: "Check in/out, history",
        badgeType: "Success"
      },
      {
        key: "leave",
        title: "Leave",
        icon: "sap-icon://leave",
        route: "leave",
        available: true,
        info: "Apply, approvals",
        badgeType: "Success"
      },
      {
        key: "timesheet",
        title: "Timesheets",
        icon: "sap-icon://time-entry-request",
        route: "timesheets",
        available: true,
        info: "Periods, items, submit",
        badgeType: "Success"
      },
      {
        key: "shifts",
        title: "Shifts & Roster",
        icon: "sap-icon://validations",
        route: "shifts",
        available: true,
        info: "Shifts, schedules, holidays",
        badgeType: "Success"
      },
      {
        key: "geo",
        title: "Geo-Attendance",
        icon: "sap-icon://globe",
        route: "geo",
        available: true,
        info: "Geofences & evidence (read-only)",
        badgeType: "Success"
      },
      {
        key: "payroll",
        title: "Payroll",
        icon: "sap-icon://payment-approval",
        route: null,
        available: false,
        info: "Later sprint",
        badgeType: "Neutral"
      },
      {
        key: "workflow",
        title: "Approvals (Workflow)",
        icon: "sap-icon://workflow-tasks",
        route: null,
        available: false,
        info: "Later sprint",
        badgeType: "Neutral"
      },
      {
        key: "documents",
        title: "Documents & Compliance",
        icon: "sap-icon://document",
        route: null,
        available: false,
        info: "Later sprint",
        badgeType: "Neutral"
      },
      {
        key: "reports",
        title: "Reports & Dashboards",
        icon: "sap-icon://bar-chart",
        route: null,
        available: false,
        info: "Later sprint",
        badgeType: "Neutral"
      }
    ]
  };

  return {
    getModel: function () {
      return new JSONModel(oConfig);
    },
    getServiceURL: function (sService) {
      return oConfig.services[sService] || null;
    }
  };
});
