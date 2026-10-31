const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // Bind to the SERVED entity names "Holidays"/"HolidayCalendars" (see
  // handlers/attendance.js for the reasoning). Registering with the db
  // entity names silently disabled the holiday validations at runtime.
  const { Holidays, HolidayCalendars } = srv.entities;

  // ==================
  // CREATE
  // ==================

  // NOTE: the previous code named the request object 'srv' and then
  // read 'req.data.*' from it - although the misnamed variable still
  // pointed at the request object, this hid the intent of the code.
  // The parameter is now correctly named 'req'.
  srv.before("CREATE", Holidays, async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.holidayCalendar_ID)
      return req.error(400, "Holiday Calendar is required");

    if (!req.data.name) return req.error(400, "Holiday name is required");

    if (!req.data.holidayDate)
      return req.error(400, "Holiday date is required");

    const calendar = await tx.run(
      SELECT.one
        .from(HolidayCalendars)
        .where({ ID: req.data.holidayCalendar_ID }),
    );

    if (!calendar) {
      return req.error(400, "Holiday Calendar is not found");
    }

    const holidayYear = new Date(req.data.holidayDate).getFullYear();

    if (holidayYear != calendar.year) {
      return req.error(
        400,
        "Holiday Date must belong to the selected Holiday Calendar year.",
      );
    }

    const exisitingHoliday = await tx.run(
      SELECT.one.from(Holidays).where({
        holidayCalendar_ID: req.data.holidayCalendar_ID,
        holidayDate: req.data.holidayDate,
      }),
    );

    if (exisitingHoliday) {
      return req.error(400, "A Holiday already exists for this date.");
    }
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", Holidays, async (req) => {
    const tx = cds.transaction(req);

    // Key extraction must not rely on req.data.ID - PATCH payloads
    // carry only the changed fields. Read the key from the request
    // params first, fall back to the payload (previously the handler
    // compared against the undefined req.ID and reported every
    // legitimate date edit as a duplicate).
    const targetId =
      req.params?.[0]?.ID ||
      (typeof req.params?.[0] === "string" ? req.params[0] : null) ||
      req.data.ID;

    const currentHoliday = await tx.run(
      SELECT.one.from(Holidays).where({ ID: targetId }),
    );

    if (!currentHoliday) {
      return req.error(404, "Holiday not found");
    }

    const holidayCalenday_ID =
      req.data.holidayCalendar_ID ?? currentHoliday.holidayCalendar_ID;

    const holidayDate = req.data.holidayDate ?? currentHoliday.holidayDate;

    const calendar = await tx.run(
      SELECT.one.from(HolidayCalendars).where({ ID: holidayCalenday_ID }),
    );

    if (!calendar) {
      return req.error(400, "Holiday Calendar not found");
    }

    const holidayYear = new Date(holidayDate).getFullYear();

    if (holidayYear !== calendar.year)
      return req.error(
        400,
        "Holiday Date must belong to the selected Holiday Calendar year.",
      );

    const exisitingHoliday = await tx.run(
      SELECT.one.from(Holidays).where({
        holidayCalendar_ID: holidayCalenday_ID,
        holidayDate,
      }),
    );

    if (exisitingHoliday && exisitingHoliday.ID !== targetId) {
      return req.error(400, "A Holiday already exists for this date.");
    }
  });

  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", Holidays, async (req) => {
    // Attendance
    // Leave
    // Payroll
  });
};
