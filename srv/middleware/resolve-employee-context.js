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
      }
    } catch (err) {
      console.error("Failed to resolve employee context:", err);
    }
    next();
  });
});

module.exports = employeeContextCache;
