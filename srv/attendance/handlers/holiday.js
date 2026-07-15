const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  const { Holiday, HolidayCalendar } = srv.entities;

  // ==================
  // CREATE
  // ==================

  srv.before("CREATE", "Holiday", async (srv) => {
    const tx = cds.transaction(srv);

    if (!req.data.holidayCalendar_ID)
      return req.error(400, "Holiday Calendar is required");

    if (!req.data.name) return req.error(400, "Holiday name is required");

    if (!req.data.holidayDate)
      return req.error(400, "Holiday date is required");

    const calendar = await tx.run(
      SELECT.one
        .from(HolidayCalendar)
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
      SELECT.one.from(Holiday).where({
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

  srv.before("UPDATE", "Holiday", async (srv) => {
    const tx = cds.transaction(srv);

    const currentHoliday = await tx.run(
      SELECT.one.from(Holiday).where({ ID: req.data.ID }),
    );

    if (!currentHoliday) {
      return req.error(404, "Holiday not found");
    }

    const holidayCalenday_ID =
      req.data.holidayCalendar_ID ?? currentHoliday.holidayCalendar_ID;

    const holidayDate = req.data.holidayDate ?? currentHoliday.holidayDate;

    const calendar = await tx.run(
      SELECT.one.from(HolidayCalendar).where({ ID: holidayCalenday_ID }),
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
      SELECT.one.from(Holiday).where({ holidayCalenday_ID, holidayDate }),
    );

    if (exisitingHoliday && exisitingHoliday.ID !== req.ID) {
      return req.error(400, "A Holiday already exists for this date.");
    }
  });

  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", "Holiday", async (srv) => {
    // Attendance
    // Leave
    // Payroll
  });
};
