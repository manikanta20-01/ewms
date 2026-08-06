const cds = require("@sap/cds");
const {
  registerAuditHooks,
  attachAuditLogReadFormatter,
} = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  // Return AuditLogs.oldName/newName as real nested JSON instead of an
  // escaped JSON string.
  attachAuditLogReadFormatter(this, "AuditLogs");

  // Attach the Enterprise Audit Framework
  registerAuditHooks(this, {
    include: [
      "Employees",
      "Designations",
      "Grades",
      "EmployeeAssignments",
      "Banks",
      "Education",
      "Experience",
      "Documents",
      "StatutoryDetails",
    ],
  });

  require("./handlers/employee")(this);
  require("./handlers/designation")(this);
  require("./handlers/grade")(this);
  require("./handlers/employee-assignment")(this);
  require("./handlers/bank")(this);
  require("./handlers/education")(this);
  require("./handlers/experience")(this);
  require("./handlers/document")(this);
  require("./handlers/statutory-detail")(this);
});