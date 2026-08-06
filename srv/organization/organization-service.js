const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    include: [
      "Companies",
      "BusinessUnits",
      "Departments",
      "Locations",
      "DepartmentHRs",
    ],
  });

  require("./handlers/company")(this);
  require("./handlers/business-unit")(this);
  require("./handlers/location")(this);
  require("./handlers/department")(this);
  require("./handlers/department-hr")(this);
});
