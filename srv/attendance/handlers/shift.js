const cds = require("@sap/cds");
const { SELECT } = cds.ql;

const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { Shift } = srv.entities;
  // ==================
  // CREATE
  // ==================
  srv.before("CREATE", "Shift", async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.name) return req.error(400, "Shiftname is required");
    if (!req.data.startTime) return req.error(400, "Start time is required");
    if (!req.data.endTime) return req.error(400, "End time is required");

    if (req.data.startTime == req.data.endTime)
      return req.error(400, "Starttime and Endtime cannot be the same");

    if ((req.data.breakMinutes ?? 0) < 0)
      return req.error(400, "Break minutes cannot be negative");

    if ((req.data.graceInMinutes ?? 0) < 0)
      return req.error(400, "Grace in minutes cannot negative");

    if ((req.data.graceOutMinutes ?? 0) < 0)
      return req.error(400, "Grace out minutes cannot negative");

    if ((req.data.worklyHours ?? 0) <= 0)
      return req.error(400, "Weekly hours must be greater than zero");

    const exisitingShift = await tx.run(
      SELECT.one.from(Shift).where({
        name: req.data.name,
      }),
    );

    if (exisitingShift) return req.error(400, "Shift Name already exists.");

    req.data.shiftCode = await generateCode(req, Shift, "shiftCode", "SH", 5);
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", "Shift", async (req) => {
    const tx = cds.transaction(req);

    if ("shiftCode" in req.data) {
      return req.error(400, "Shift Code cannot be modified.");
    }

    if (
      req.data.startTime &&
      req.data.endTime &&
      req.data.startTime == req.data.endTime
    ) {
      return req.error(400, "Starttime and Endtime cannot be the same");
    }

    if (req.data.breakMinutes !== undefined && req.data.breakMinutes < 0) {
      return req.error(400, "Break Minutes cannot be negative.");
    }

    if (req.data.graceInMinutes !== undefined && req.data.graceInMinutes < 0) {
      return req.error(400, "Grace In Minutes cannot be negative.");
    }

    if (
      req.data.graceOutMinutes !== undefined &&
      req.data.graceOutMinutes < 0
    ) {
      return req.error(400, "Grace Out Minutes cannot be negative.");
    }

    if (req.data.worklyHours !== undefined && req.data.worklyHours <= 0) {
      return req.error(400, "Weekly Hours must be greater than zero.");
    }

    if (req.data.name) {
      const exisitingShift = await tx.run(
        SELECT.one.from(Shift).where({
          name: req.data.name,
        }),
      );

      if (exisitingShift && exisitingShift.ID != req.data.ID) {
        return req.error(400, "Shift Name already exists.");
      }
    }
  });

  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", "Shift", async (req) => {
    const tx = cds.transaction(req);

    // check shift assignment
    const shiftAssigment = await tx.run(
      SELECT.one
        .from("ewms.db.attendance.ShiftAssignment")
        .where({ shift_ID: req.data.ID }),
    );

    if (shiftAssigment) {
      return req.error(
        400,
        "Cannot delete Shift. It is assigned to one or more employees.",
      );
    }

    // check attendance
    const attendance = await tx.run(
      SELECT.one
        .from("ewms.db.attendance.attendance")
        .where({ shift_ID: req.data.ID }),
    );

    if (attendance) {
      return req.error(400, "Cannot delete Shift. Attendance history exists.");
    }

    // check workschedule
    const workSchedule = await tx.run(
      SELECT.one
        .from("ewms.db.attendance.workSchedule")
        .where({ shift_ID: req.data.ID }),
    );

    if (workSchedule) {
      return req.error(
        400,
        "Cannot delete Shift. It is used in Work Schedule.",
      );
    }
  });
};
