const cds = require("@sap/cds");
const attendance = require("./attendance");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // Bind to the SERVED entity name "Overtimes" (the projection in
  // attendance-service.cds). Registering with the db entity name
  // "Overtime" never matched a dispatched request, which silently
  // disabled every validation below. Master-data entities from other
  // modules (Employee) and entities of the same module that are simply
  // not projected here (Attendance) are addressed through fully
  // qualified db entity names - same pattern as handlers/attendance.js.
  const { Overtimes } = srv.entities;
  const Employee = "ewms.db.employee.Employee";
  const Attendance = "ewms.db.attendance.Attendance";
  const Overtime = "ewms.db.attendance.Overtime";

  // ==================
  // CREATE
  // ==================

  srv.before("CREATE", Overtimes, async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.employee_ID) return req.error(400, "Employee is required.");

    if (!req.data.attendance_ID)
      return req.error(400, "Attendance is required.");

    if (!req.data.approvedHours)
      return req.error(400, "Approved Hours is required.");

    // Employee Exists
    const employee = await tx.run(
      SELECT.one.from(Employee).where({ ID: req.data.employee_ID }),
    );
    if (!employee) return req.error(400, "Employee not found");

    // Attendance exists
    const attendance = await tx.run(
      SELECT.one.from(Attendance).where({ ID: req.data.attendance_ID }),
    );

    if (!attendance) return req.error(400, "Attendance record not found");

    // Attendance belongs to employee

    if (attendance.employee_ID !== req.data.employee_ID)
      return req.error(
        400,
        "Attendance does not belong to the selected employee.",
      );

    // Approver must reference a real employee. Previously this
    // existence check lived only in UPDATE (and asked for the wrong
    // entity there), so a CREATE with a bogus approver succeeded.
    if (req.data.approvedBy_ID) {
      const approver = await tx.run(
        SELECT.one.from(Employee).where({ ID: req.data.approvedBy_ID }),
      );
      if (!approver) return req.error(400, "Approver not found");
      req.data.approvedDate = new Date();
    }

    // Employee checked out
    if (!attendance.checkOut)
      return req.error(400, "Employee has not checked out yet.");

    // Duplicate Overtime
    const existingOT = await tx.run(
      SELECT.one
        .from(Overtime)
        .where({ attendance_ID: req.data.attendance_ID }),
    );

    if (existingOT)
      return req.error(400, "Overtime already exists for this attendance.");

    // Maximum Overtime
    const extraHours = attendance.workedHours - 8;

    if (extraHours <= 0)
      return req.error(400, "Employee not eligible for overtime");

    if (req.data.approvedHours > extraHours)
      return req.error(
        400,
        `Approved hours cannot exceed ${extraHours} hours (worked ${attendance.workedHours}h beyond the 8h standard).`,
      );
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", Overtimes, async (req) => {
    const tx = cds.transaction(req);

    // Key extraction must not rely on req.data.ID - PATCH payloads
    // commonly carry only the fields being changed. Read the key from
    // the request params first (bound requests) and fall back to the
    // payload.
    const overtimeId =
      req.params?.[0]?.ID ||
      (typeof req.params?.[0] === "string" ? req.params[0] : null) ||
      req.data.ID;

    if (!overtimeId)
      return req.error(400, "Overtime record key is required.");

    // Overtime record exists
    const overtime = await tx.run(
      SELECT.one.from(Overtime).where({ ID: overtimeId }),
    );
    if (!overtime) return req.error(400, "Overtime record not found");

    // Approved Hours
    if (
      req.data.approvedHours !== undefined &&
      Number(req.data.approvedHours) < 0
    ) {
      return req.error(400, "Approved Hours cannot be negative");
    }

    if ("employee_ID" in req.data || "attendance_ID" in req.data)
      return req.error(
        400,
        "Employee and Attendance cannot be changed on an overtime record.",
      );

    // Approved By
    if (req.data.approvedBy_ID) {
      // Must AWAIT the lookup, and it must look up the APPROVER the
      // caller named - not req.data.employee_ID (the worker).
      const approver = await tx.run(
        SELECT.one.from(Employee).where({ ID: req.data.approvedBy_ID }),
      );
      if (!approver) return req.error(400, "Approver not found");
      req.data.approvedDate = new Date();
    }
  });
  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", Overtimes, async (req) => {
    return req.error(400, "Overtime records cannot be deleted.");
  });
};
