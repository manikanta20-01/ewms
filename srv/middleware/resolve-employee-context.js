const cds = require("@sap/cds");
const employeeContextCache = require("../common/utils/employee-context-cache");

cds.on("bootstrap", (app) => {
  app.use(async (req, res, next) => {
    try {
      const user = req.user;
      if (!user || !user.id || typeof user.is !== 'function') return next();

      user.attr = user.attr || {};

      if (user.attr.employeeId && user.attr.departmentId) {
        return next();
      }

      const iasUserId = user._req?.tokenInfo?.getPayload?.().sub || user.id;

      const resolved = await employeeContextCache.resolve(iasUserId);
if (resolved) {
  user.attr.employeeId = resolved.employeeId;
  user.attr.departmentId = resolved.departmentId;
} else if (user.employeeId || user.departmentId) {
  // Dev/mocked-auth fallback: package.json's mocked users define
  // employeeId/departmentId directly on the user object (not under
  // .attr). The AppUsers-based cache lookup above only resolves
  // real IAS identities, so for local/mocked auth we bridge those
  // config values into user.attr, since $user.<attr> bindings in
  // @restrict where-clauses read exclusively from user.attr.
  user.attr.employeeId = user.employeeId;
  user.attr.departmentId = user.departmentId;
}
    } catch (err) {
      console.error("Failed to resolve employee context:", err);
    }
    next();
  });
});

module.exports = employeeContextCache;
