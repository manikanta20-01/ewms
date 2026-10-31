const cds = require("@sap/cds");
const { SELECT } = cds.ql;

const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  // Bind to the SERVED entity name "Shifts" (see handlers/attendance.js
  // for the reasoning). The db entity name "Shift" never matched a
  // dispatched OData request, silently disabling the shift validations.
  const { Shifts } = srv.entities;

  // Queries against OTHER entities of the attendance module that are
  // also projections of THIS service use the qualified db entity name
  // (the exact db table names - "attendance" lowercase was never a
  // valid entity and would 500 on every delete).
  const ShiftAssignmentEntity = "ewms.db.attendance.ShiftAssignment";
  const AttendanceEntity = "ewms.db.attendance.Attendance";
  const WorkScheduleEntity = "ewms.db.attendance.WorkSchedule";
  // ==================
  // CREATE
  // ==================
  srv.before("CREATE", Shifts, async (req) => {
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
      SELECT.one.from(Shifts).where({
        name: req.data.name,
      }),
    );

    if (exisitingShift) return req.error(400, "Shift Name already exists.");

    req.data.shiftCode = await generateCode(req, Shifts, "shiftCode", "SH", 5);
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", Shifts, async (req) => {
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
        SELECT.one.from(Shifts).where({
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

  srv.before("DELETE", Shifts, async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.ID) return req.error(400, "Shift ID is required");

    // check shift assignment
    const shiftAssigment = await tx.run(
      SELECT.one
        .from(ShiftAssignmentEntity)
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
        .from(AttendanceEntity)
        .where({ shift_ID: req.data.ID }),
    );

    if (attendance) {
      return req.error(400, "Cannot delete Shift. Attendance history exists.");
    }

    // check workschedule
    const workSchedule = await tx.run(
      SELECT.one
        .from(WorkScheduleEntity)
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
