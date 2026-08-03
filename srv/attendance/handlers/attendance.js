const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // IMPORTANT: bind against the actual local entity objects from this
  // service's srv.entities (e.g. "Attendances", not the db entity name
  // "Attendance"). Passing the resolved entity object rather than a
  // string keeps the handler wired even if the projected name changes.
  const { Attendances, Shifts, WorkSchedules, ShiftAssignments } = srv.entities;

  const timeToMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  // ============================================================
  // CREATE - Check-In
  // ============================================================
  srv.before("CREATE", Attendances, async (req) => {
    const tx = cds.transaction(req);
    const { employee_ID, attendanceDate, checkIn } = req.data;

    if (!employee_ID) return req.error(400, "Employee is required");
    if (!attendanceDate) return req.error(400, "Attendance date is required");
    if (!checkIn) return req.error(400, "Employee check-in time is required");

    // Employee existence check (AttendanceService doesn't project Employee,
    // so query the underlying db entity directly)
    const employee = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: employee_ID }),
    );
    if (!employee) return req.error(404, "Employee does not exist.");

    // Duplicate attendance guard
    const existingAttendance = await tx.run(
      SELECT.one.from(Attendances).where({ employee_ID, attendanceDate }),
    );
    if (existingAttendance) {
      return req.error(
        400,
        "Attendance has already been marked for this employee on the selected date.",
      );
    }

    // --------------------------------------------------------
    // Resolve the shift for this attendance date
    // --------------------------------------------------------
    let shiftId = null;

    // Step 1 - explicit per-day WorkSchedule override
    const workSchedule = await tx.run(
      SELECT.one
        .from(WorkSchedules)
        .where({ employee_ID, scheduleDate: attendanceDate }),
    );

    if (workSchedule) {
      shiftId = workSchedule.shift_ID;
    } else {
      // Step 2 - fall back to the employee's active shift assignment
      // that covers this date
      const assignments = await tx.run(
        SELECT.from(ShiftAssignments).where({ employee_ID }),
      );

      const shiftAssignment = assignments.find(
        (a) =>
          attendanceDate >= a.effectiveFrom &&
          (!a.effectiveTo || attendanceDate <= a.effectiveTo),
      );

      if (!shiftAssignment) {
        return req.error(
          400,
          "No active shift assignment found for the attendance date.",
        );
      }

      shiftId = shiftAssignment.shift_ID;
    }

    req.data.shift_ID = shiftId;

    // --------------------------------------------------------
    // Calculate late minutes against the resolved shift
    // --------------------------------------------------------
    const shift = await tx.run(SELECT.one.from(Shifts).where({ ID: shiftId }));
    if (!shift) return req.error(404, "Assigned shift was not found.");

    const shiftStartMinutes = timeToMinutes(shift.startTime);
    const checkInMinutes = timeToMinutes(checkIn);
    const allowedCheckInMinutes =
      shiftStartMinutes + (shift.graceInMinutes || 0);

    req.data.lateMinutes = Math.max(0, checkInMinutes - allowedCheckInMinutes);

    // --------------------------------------------------------
    // Work location + initial status
    // --------------------------------------------------------
    req.data.workLocation = req.data.workLocation || "Office";
    req.data.attendanceStatus =
      req.data.workLocation === "WorkFromHome" ? "WorkFromHome" : "Present";
  });

  // ============================================================
  // UPDATE - Check-Out
  // ============================================================
  srv.before("UPDATE", Attendances, async (req) => {
    const tx = cds.transaction(req);
    const targetId = req.data.ID || req.params?.[0]?.ID || req.params?.[0];

    if (!targetId) return;

    const attendance = await tx.run(
      SELECT.one.from(Attendances).where({ ID: targetId }),
    );
    if (!attendance) return req.error(404, "Attendance record not found.");

    // System-owned / immutable fields
    if ("employee_ID" in req.data)
      return req.error(400, "Employee cannot be modified.");
    if ("attendanceDate" in req.data)
      return req.error(400, "Attendance date cannot be modified.");
    if ("shift_ID" in req.data)
      return req.error(400, "Shift cannot be modified.");
    if ("workLocation" in req.data)
      return req.error(400, "Work location cannot be modified after check-in.");
    if ("workedHours" in req.data)
      return req.error(400, "Worked hours is system calculated.");
    if ("lateMinutes" in req.data)
      return req.error(400, "Late minutes is system calculated.");
    if ("earlyLeavingMinutes" in req.data)
      return req.error(400, "Early leaving minutes is system calculated.");

    // Only proceed with checkout math if a checkOut is actually being set
    if (!("checkOut" in req.data)) return;

    if (!req.data.checkOut)
      return req.error(400, "Check-out time is required.");
    if (attendance.checkOut)
      return req.error(400, "Employee has already checked out.");
    if (!attendance.checkIn)
      return req.error(400, "Employee has not checked in.");

    const checkInMinutes = timeToMinutes(attendance.checkIn);
    const checkOutMinutes = timeToMinutes(req.data.checkOut);

    if (checkOutMinutes <= checkInMinutes) {
      return req.error(400, "Check-out time must be later than check-in time.");
    }

    const totalMinutes = checkOutMinutes - checkInMinutes;
    const totalWorkedHours = Number((totalMinutes / 60).toFixed(2));
    req.data.workedHours = totalWorkedHours;

    const shift = await tx.run(
      SELECT.one.from(Shifts).where({ ID: attendance.shift_ID }),
    );
    if (!shift) return req.error(404, "Assigned shift was not found.");

    const shiftEndMinutes = timeToMinutes(shift.endTime);
    req.data.earlyLeavingMinutes = Math.max(
      0,
      shiftEndMinutes - checkOutMinutes,
    );

    // Recompute final status from worked hours, preserving Holiday/Leave
    // and the WFH/Office distinction captured at check-in.
    if (
      attendance.attendanceStatus !== "Holiday" &&
      attendance.attendanceStatus !== "Leave"
    ) {
      const isWFH = attendance.workLocation === "WorkFromHome";
      if (totalWorkedHours >= 8) {
        req.data.attendanceStatus = isWFH ? "WorkFromHome" : "Present";
      } else if (totalWorkedHours >= 4) {
        req.data.attendanceStatus = "HalfDay";
      } else {
        req.data.attendanceStatus = "Absent";
      }
    }
  });

  // ============================================================
  // DELETE - Attendance records are immutable once created
  // ============================================================
  srv.before("DELETE", Attendances, async (req) => {
    return req.error(400, "Attendance records cannot be deleted.");
  });
};
