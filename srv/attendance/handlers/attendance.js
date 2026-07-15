const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  const { Employee, Attendance, WorkSchedule, ShiftAssignment, Shift } =
    srv.entities;
  srv.before("CREATE", "Attendance", async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.employee_ID) {
      req.error(400, "Employee is required");
    }

    if (!req.data.attendanceDate) {
      req.error(400, "Attendance date is required");
    }

    if (!req.data.checkIn) {
      req.error(400, "EMployee check In is required");
    }

    // check employee exists
    const employee = await tx.run(
      SELECT.one.from(Employee).where({
        ID: req.data.employee_ID,
      }),
    );

    if (!employee) return req.error(400, "Employee is not exists");

    // Duplicate Attendance Validation
    const exisitingAttendance = await tx.run(
      SELECT.one.from(Attendance).where({
        employee_ID: req.data.employee_ID,
        attendanceDate: req.data.attendanceDate,
      }),
    );

    if (exisitingAttendance)
      return req.error(
        400,
        "Attendance has already been marked for this employee on the selected date.",
      );

    // ==================
    // Find Employee Shift
    // ==================

    let shiftId = null;

    // Step 1 - Check Work Schedule

    const workSchedule = await tx.run(
      SELECT.one.from(WorkSchedule).where({
        employee_ID: req.data.employee_ID,
        scheduleDate: req.data.attendanceDate,
      }),
    );

    if (workSchedule) {
      shiftId = workSchedule.shift_ID;
    } else {
      // Step 2 - Find Active Shift Assignment

      const shiftAssignment = await tx.run(
        SELECT.one.from(ShiftAssignment).where({
          employee_ID: req.data.employee_ID,
        }),
      );

      if (!shiftAssignment) {
        return req.error(400, "No shift assigned for employee.");
      }

      // Step 3 - Validate Assignment Date

      if (
        req.data.attendanceDate < shiftAssignment.effectiveFrom ||
        (shiftAssignment.effectiveTo &&
          req.data.attendanceDate > shiftAssignment.effectiveTo)
      ) {
        return req.error(
          400,
          "No active shift assignment found for the attendance date.",
        );
      }

      shiftId = shiftAssignment.shift_ID;
    }

    // Step 4 - Save Shift in Attendance

    req.data.shift_ID = shiftId;

    // ==================
    // Get Shift Details
    // ==================

    const shift = await tx.run(
      SELECT.one.from(Shift).where({
        ID: shift_ID,
      }),
    );
    if (!shift) return req.error(400, "Assigned shift is not found");

    // ==================
    // Calculate Late Minutes
    // ==================
    // shift start time
    const [shiftHour, shiftMinute] = shift.startTime.split(":").map(Number);
    const shiftStartMinutes = shiftHour * 60 + shiftMinute;

    // employee check in time
    const [checkInHour, checkInMinute] = req.data.checkIn
      .split(":")
      .map(Number);
    checkInMinute = checkInHour * 60 + checkInMinute;

    // Allowed check time
    const allowedCheckIn = shiftStartMinutes + (shift.graceInMinutes || 0);

    // Late minutes
    const lateMinutes = checkInMinute - allowedCheckIn;

    if (lateMinutes < 0) {
      lateMinutes = 0;
    }

    // save calculated values
    req.data.shift_ID = shiftId;
    req.data.attendanceDate = attendanceDate;
    req.data.attendanceStatus = "Present";

    // ==================
    // UPDATE
    // ==================

    srv.before("UPDATE", "Attendance", async (req) => {
      const tx = cds.transaction(req);

      // Check attendance Exists
      const attendance = await tx.run(
        SELECT.one.from(Attendance).where({ ID: req.data.ID }),
      );

      if (!attendance) return req.error(400, "Attendance record not found.");

      if ("employee_ID" in req.data)
        return req.error(400, "Employee cannot be modified.");

      if ("attendanceDate" in req.data)
        return req.error(400, "Attendance Date cannot be modified.");

      if ("shift_ID" in req.data)
        return req.error(400, "Shift cannot be modified.");

      if ("workedHours" in req.data)
        return req.error(400, "Worked Hours is system calculated.");

      if ("lateMinutes" in req.data)
        return req.error(400, "Late Minutes is system calculated.");

      if ("earlyLeavingMinutes" in req.data)
        return req.error(400, "Early Leaving Minutes is system calculated.");

      // check out required
      if (!req.data.checkOut)
        return req.error(400, "Check out time is required");

      // Already check out
      if (attendance.checkOut)
        return req.error(400, "Employee has already checkout");

      // check in required
      if (!attendance.checkIn)
        return req.error(400, "Employee has not checked in.");

      // ===============================
      // Convert check In into minutes
      // ===============================
      const [checkInHour, checkInMinute] = req.data.checkIn
        .split(":")
        .map(Number);

      const checkInMinutes = checkInHour * 60 + checkInMinute;

      // ===============================
      // Convert check Out into minutes
      // ===============================
      const [checkOutHour, checkOutMinute] = req.data.checkOut
        .split(":")
        .map(Number);

      const checkOutMinutes = checkOutHour * 60 + checkOutMinute;

      // Validate Time
      if (checkOutMinutes <= checkInMinutes)
        return req.error(
          400,
          "Check Out time must be greater than Check In time.",
        );

      // --------------------------
      // Calculate Worked Hours
      // --------------------------

      const totalMinutes = checkOutMinutes - checkInMinutes;

      const totalWorkedHours = Number((totalMinutes / 60).toFixed(2));

      req.data.workedHours = totalWorkedHours;

      // --------------------------
      // Load Shift
      // --------------------------

      const shift = await tx.run(
        SELECT.one.from(Shift).where({ ID: attendance.shift_ID }),
      );

      if (!shift) return req.error(400, "Assigned shift not assign");

      // --------------------------
      // Calculate Early Leaving
      // --------------------------

      const [endHour, endMinute] = shift.endTime.split(":").map(Number);

      const shiftEndMinutes = endHour * 60 + endMinute;

      let earlyLeavingMinutes = shiftEndMinutes - checkOutMinutes;

      if (earlyLeavingMinutes < 0) earlyLeavingMinutes = 0;

      req.data.earlyLeavingMinutes = earlyLeavingMinutes;

      // --------------------------
      // Attendance Status
      // --------------------------

      if (
        attendance.attendanceStatus !== "Holiday" &&
        attendance.attendanceStatus !== "Leave"
      ) {
        if (totalWorkedHours >= 8) {
          req.data.attendanceStatus = "Present";
        } else if (totalWorkedHours >= 4) {
          req.data.attendanceStatus = "HalfDay";
        } else {
          req.data.attendanceStatus = "Absent";
        }
      }
    });
    srv.before("DELETE", "Attendance", async (req) => {
      return req.error(400, "Attendance records cannot be deleted.");
    });
  });
};
