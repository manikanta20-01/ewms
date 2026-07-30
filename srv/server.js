const cds = require("@sap/cds");
require("./middleware/resolve-employee-context");
require("./middleware/login-history");

module.exports = cds.server;
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
