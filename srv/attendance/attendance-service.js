const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    // The list must use the SERVED entity short names (projections in
    // attendance-service.cds). The db-style names "Attendance"/"Overtime"
    // never matched a served entity, so those writes were silently not
    // audited.
    include: [
      "Attendances",
      "Overtimes",
      "ShiftAssignments",
      "WorkSchedules",
      "Shifts",
      "Holidays",
      "HolidayCalendars",
    ],
  });

  require("./handlers/shift")(this);
  require("./handlers/holiday")(this);
  require("./handlers/attendance")(this);
  require("./handlers/shift-assignment")(this);
  require("./handlers/workSchedule")(this);
  require("./handlers/overtime")(this);
  require("./handlers/holiday-calendar")(this);
});
