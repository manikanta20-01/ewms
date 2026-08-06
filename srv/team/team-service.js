const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: ["Teams", "TeamManagers"],
  });

  require("./handlers/team")(this);
  require("./handlers/team-manager")(this);
});
