const cds = require("@sap/cds");
const attendance = require("./attendance");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  const { Overtime, Employee, Attendance } = srv.entities;

  // ==================
  // CREATE
  // ==================

  srv.before("CREATE", "Overtime", async (req) => {
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
      return req.error(400, "Approved hours cannot exceed ${extraHours} hours");
  });

  // ==================
  // UPDATE
  // ==================

  srv.before("UPDATE", "Overtime", async (req) => {
    const tx = cds.transaction(req);

    // Overtime record exists
    const overtime = await tx.run(
      SELECT.one.from(Overtime).where({ ID: req.data.ID }),
    );
    if (!overtime) return req.error(400, "Overtime record not found");

    // Approved Hours
    if (req.data.approvedHours < 0 && req.data.approvedHours !== undefined) {
      return req.error(400, "Approved Hours cannot be negative");
    }

    // Approved By

    if (req.data.approvedBy_ID) {
      const approver = tx.run(
        SELECT.one.from(Employee).where({ ID: req.data.employee_ID }),
      );
      if (!approver) return req.error(400, "Approver cannot found");
      req.data.approvedDate = new Date();
    }
  });
  // ==================
  // DELETE
  // ==================

  srv.before("DELETE", "Overtime", async (req) => {
    return req.error(400, "Overtime records cannot be deleted.");
  });
};
