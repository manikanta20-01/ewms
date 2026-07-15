const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {
  require("./handlers/shift")(this);
  require("./handlers/holiday")(this);
  require("./handlers/attendance")(this);
  require("./handlers/shift-assignment")(this);
  require("./handlers/workSchedule")(this);
  require("./handlers/overtime")(this);
  require("./handlers/holiday-calendar")(this);
});
