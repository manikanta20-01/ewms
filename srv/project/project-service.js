const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Projects", "ProjectManagers"],
  });

  require("./handlers/project")(this);
  require("./handlers/project-manager")(this);
});
