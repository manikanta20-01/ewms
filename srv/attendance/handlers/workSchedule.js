const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // Bind to the SERVED entity name "WorkSchedules" (the projection in
  // attendance-service.cds). The db entity name never matched a dispatched
  // OData request, silently disabling every validation below. Employee
  // master data lives in another module and is addressed through its
  // fully qualified db entity name.
  const { WorkSchedules, Shifts } = srv.entities;
  const Employee = "ewms.db.employee.Employee";
  // =============
  // CREATE
  // =============
  srv.before("CREATE", WorkSchedules, async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.employee_ID) return req.error(400, "Employee is required");

    if (!req.data.shift_ID) return req.error(400, "Shift is required.");

    if (!req.data.scheduleDate)
      return req.error(400, "work schedule date is required");

    // Employee Exists
    const employee = await tx.run(
      SELECT.one.from(Employee).where({ ID: req.data.employee_ID }),
    );
    if (!employee) {
      return req.error(400, "Employee not found");
    }

    // shift exists
    const shift = await tx.run(
      SELECT.one.from(Shift).where({ ID: req.data.shift_ID }),
    );
    if (!shift) {
      return req.error(400, "Shift not found");
    }

    // check duplicate schedule
    const duplicate = await tx.run(
      SELECT.one.from(WorkSchedules).where({
        employee_ID: req.data.employee_ID,
        scheduleDate: req.data.scheduleDate,
      }),
    );
    if (duplicate) {
      return req.error(400, "Employee Work schedule already exists");
    }

    // Reject past dates
    const today = new Date().toISOString().split("T")[0];

    if (req.data.scheduleDate < today)
      return req.error(400, "Work Schedule cannot be created for a past date.");
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", WorkSchedules, async (req) => {
    const tx = cds.transaction(req);

    // Key extraction must not rely on req.data.ID - PATCH payloads
    // carry only the changed fields. Read the key from the request
    // params first (bound requests), fall back to the payload.
    const targetId =
      req.params?.[0]?.ID ||
      (typeof req.params?.[0] === "string" ? req.params[0] : null) ||
      req.data.ID;

    const current = await tx.run(
      SELECT.one.from(WorkSchedules).where({ ID: targetId }),
    );

    if (!current) return req.error(404, "Work Schedule not found.");

    const employee_ID = req.data.employee_ID ?? current.employee_ID;

    const shift_ID = req.data.shift_ID ?? current.shift_ID;

    const scheduleDate = req.data.scheduleDate ?? current.scheduleDate;

    // Employee validation

    const employee = await tx.run(
      SELECT.one.from(Employee).where({ ID: employee_ID }),
    );

    if (!employee) return req.error(400, "Employee not found.");

    // Shift validation

    const shift = await tx.run(
      SELECT.one.from(Shifts).where({ ID: shift_ID }),
    );

    if (!shift) return req.error(400, "Shift not found.");

    // Duplicate Work Schedule

    const duplicate = await tx.run(
      SELECT.one.from(WorkSchedules).where({
        employee_ID,
        scheduleDate,
      }),
    );

    if (duplicate && duplicate.ID !== current.ID) {
      return req.error(400, "Employee Work Schedule already exists.");
    }
  });

  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", WorkSchedules, async (req) => {
    const tx = cds.transaction(req);

    // Get current Work Schedule (key from params - DELETE requests
    // carry no payload at all, so req.data.ID alone can be undefined)
    const targetId =
      req.params?.[0]?.ID ||
      (typeof req.params?.[0] === "string" ? req.params[0] : null) ||
      req.data.ID;

    const workSchedule = await tx.run(
      SELECT.one.from(WorkSchedules).where({ ID: targetId }),
    );

    if (!workSchedule) return req.error(404, "Work Schedule not found.");

    // Check Attendance

    const attendance = await tx.run(
      SELECT.one.from("ewms.db.attendance.Attendance").where({
        employee_ID: workSchedule.employee_ID,
        attendanceDate: workSchedule.scheduleDate,
      }),
    );

    if (attendance) {
      return req.error(
        400,
        "Cannot delete Work Schedule. Attendance has already been recorded.",
      );
    }
  });
};
