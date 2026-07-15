const cds = require("@sap/cds");
const { SELECT } = cds.ql;



module.exports = (srv) => {
  const { ShiftAssignment, Employee, Shift, Attendance, WorkSchedule } =
    srv.entities;
// =============
// CREATE
// =============
  srv.before("CREATE", "ShiftAssignment", async () => {
    const tx = cds.transaction(srv);

    if (!req.data.employee_ID) return req.error(400, "Employee is required");

    if (!req.data.shift_ID) return req.error(400, "Shift is not found");

    if (!req.data.effectiveFrom)
      return req.error(400, "Effective date is required");

    if (
      !req.data.effectiveTo &&
      req.data.effectiveTo < req.data.effectiveFrom
    ) {
      return req.error(
        400,
        "Effective To must be greater than or equal to Effective From.",
      );
    }

    // employee exists
    const employee = await tx.run(
      SELECT.one.from(Employee).where({ ID: req.data.employee_ID }),
    );

    if (!employee) return req.error(400, "Employee not found");

    // shift exists
    const shift = await tx.run(
      SELECT.one.from(Shift).where({ ID: req.data.shift_ID }),
    );

    if (!shift) return req.error(400, "Shift not found");

    // check overlap assignment
    const overlap = await tx.run(
      SELECT.one
        .from(ShiftAssignment)
        .where({ employee_ID: req.data.employee_ID }),
    );

    if (overlap)
      return req.error(
        400,
        "Employee already has a Shift Assignment. Please update the existing assignment.",
      );
  });

  // =============
  // UPDATE
  // =============

  srv.before("UPDATE", "ShiftAssignment", async () => {
    const tx = cds.transaction(srv);

    const current = tx.run(
      SELECT.one.from(ShiftAssignment).where({ ID: req.data.ID }),
    );

    if (!current) return req.error(400, "shift Assigment not found");

    const effectiveFrom = req.data.effectiveFrom ?? current.effectiveFrom;
    const effectiveTo = req.data.effectiveTo ?? current.effectiveTo;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      return req.error(
        400,
        "Effective To must be greater than or equal to Effective From.",
      );
    }
  });

  // =============
  // DELETE
  // =============

  srv.before("DELETE", "ShiftAssignment", async () => {
    const tx = cds.transaction(srv);

    // check attendance

    const attendance = await tx.run(
      SELECT.one.from(Attendance).where({ employee_ID: req.data.employee_ID }),
    );

    if (attendance) {
      return req.error(
        400,
        "Cannot delete Shift Assignment. Attendance records exist.",
      );
    }

    // check workschedule

    const workSchedule = await tx.run(
      SELECT.one
        .from(WorkSchedule)
        .where({ employee_ID: req.data.employee_ID }),
    );
    if (workSchedule) {
      return req.error(
        400,
        "Cannot delete Shift Assignment. It is used in Work Schedule.",
      );
    }
  });
};
