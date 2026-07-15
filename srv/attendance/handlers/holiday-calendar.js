const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");

module.exports = async (srv) => {
  const db = await cds.connect.to('db');
  const { HolidayCalendar } = cds.entities('ewms.db.attendance');

  // ==================
  // CREATE
  // ==================
  srv.before("CREATE", "HolidayCalendar", async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.name) return req.error(400, "Holiday Name is required");

    if (!req.data.year) return req.error(400, "Holiday Year is required");

    if (req.data.year < 2000 || req.data.year > 2040)
      return req.error(400, "Please enter a valid year.");

    const exisitingCalendar = await tx.run(
      SELECT.one.from(HolidayCalendar).where({
        name: req.data.name,
        year: req.data.year,
        country: req.data.country,
      }),
    );

    if (exisitingCalendar) {
      return req.error(
        400,
        "Holiday Calendar already exists for the selected Country and Year.",
      );
    }

    req.data.calendarCode = await generateCode(
      req,
      HolidayCalendar,
      "country",
      "HC",
      5,
    );
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", "HolidayCalendar", async (req) => {
    const tx = cds.transaction(req);

    if ("calendarCode" in req.data)
      return req.error(400, "Holiday Calendar Code cannot be modified.");

    if (req.data.year != undefined) {
      if (req.data.year < 2000 || req.data.year > 2040)
        return req.error(400, "Please enter a valid year.");
    }

    if (req.data.name || req.data.year || req.data.country) {
      const current = await tx.run(
        SELECT.one.from(HolidayCalendar).where({ ID: req.data.ID }),
      );
      const name = req.data.name ?? current.name;
      const year = req.data.name ?? current.year;
      const country = req.data.country ?? current.country;

      const exisitingCalendar = await tx.run(
        SELECT.one.from(HolidayCalendar).where({
          name,
          year,
          country,
        }),
      );

      if (exisitingCalendar && exisitingCalendar.ID !== req.data.ID) {
        return req.error(
          400,
          "Holiday Calendar already exists for the selected Country and Year.",
        );
      }
    }
  });

  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", "HolidayCalendar", async (req) => {
    const tx = cds.transaction(req);

    const holiday = await tx.run(
      SELECT.one
        .from("ewms.db.attendance.Holiday")
        .where({ holidayCalendar_ID: req.data.ID }),
    );

    if (holiday) {
      return req.error(
        400,
        "Cannot delete Holiday Calendar. Holidays are associated with it.",
      );
    }
  });
};
