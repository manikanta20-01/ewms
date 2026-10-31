const cds = require("@sap/cds");
require("./middleware/resolve-employee-context");
require("./middleware/login-history");

module.exports = cds.server;

// ------------------------------------------------------------
// SPRINT 24 - OPTIONAL BACKGROUND SCHEDULER.
// Env-gated and OFF by default (EWMS_JOBS_ENABLED=true + interval);
// it never starts under CDS_ENV=test / NODE_ENV=test, so tests
// cannot hang. See srv/jobs/scheduler.js and SPRINT-24.md.
// ------------------------------------------------------------
require("./jobs/scheduler").start();

cds.on("served", () => {
  const { PayrollService } = cds.services;
  PayrollService.before("*", (req) => {
    console.log(
      "EVENT:",
      req.event,
      "USER ROLES:",
      req.user && req.user.roles,
      "USER OBJ:",
      req.user && req.user.constructor.name,
    );
  });
});
