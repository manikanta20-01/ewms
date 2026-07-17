const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {
  require("./handlers/leave-type")(this);
  require("./handlers/leave-request")(this);
  require("./handlers/leave-policy")(this);
  require("./handlers/leave-balance")(this);
  require("./handlers/leave-approval")(this);
  require("./handlers/approval-history")(this);
});
