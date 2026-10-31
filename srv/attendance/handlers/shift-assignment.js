const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;

module.exports = (srv) => {
  // IMPORTANT: handlers must bind to the SERVED entity names (the
  // projections defined in attendance-service.cds), not the db entity
  // names. "ShiftAssignment" is never dispatched - the served entity is
  // "ShiftAssignments". Registering with the db name silently wires
  // nothing at runtime (an OData request never matched the handler) so
  // every validation below was skipped earlier. Entities of OTHER
  // modules (Employee master data) are not projected into the
  // attendance service, so they are addressed through their fully
  // qualified db entity name - the same pattern handlers/attendance.js
  // uses.
  const { ShiftAssignments, Shifts } = srv.entities;
  const Employee = "ewms.db.employee.Employee";
  const Attendance = "ewms.db.attendance.Attendance";
  const WorkSchedule = "ewms.db.attendance.WorkSchedule";

  // ------------------------------------------------------------
  // OVERLAP & SUPERSESSION (shared by CREATE and UPDATE)
  // ------------------------------------------------------------
  // Business rules (beginner-friendly):
  //
  //  1. A BOUNDED new/edited assignment (effectiveTo is set) must not
  //     intersect ANY other assignment of the SAME employee - be it
  //     bounded or running indefinitely. This prevents conflicting
  //     work records for the same days.
  //  2. An OPEN-ENDED assignment (no effectiveTo = "from now on")
  //     REPLACES an indefinite assignment the employee already holds
  //     when it starts on or after that assignment's start date. The
  //     previous indefinite assignment is automatically CLOSED the
  //     day before the new start date, so history is kept and a valid
  //     future re-assignment (e.g. a shift change next year) is easy.
  //     It only REJECTS when the new indefinite start date would fall
  //     INSIDE a later-starting assignment (cannot overwrite a pinned
  //     future plan).
  //
  // The row being edited is excluded by ID so an UPDATE never blocks
  // itself. All date comparisons are ISO 'YYYY-MM-DD' strings, which
  // compare correctly as strings.
  // ------------------------------------------------------------
  async function checkOverlapAndSupersede(
    req,
    tx,
    excludeId,
    employee_ID,
    effectiveFrom,
    effectiveTo,
  ) {
    // All other assignments of the same employee, in chronological order.
    const others = excludeId
      ? (await tx.run(
          SELECT.from(ShiftAssignments)
            .where({ employee_ID, ID: { "!=": excludeId } })
            .orderBy("effectiveFrom"),
        ))
      : (await tx.run(
          SELECT.from(ShiftAssignments)
            .where({ employee_ID })
            .orderBy("effectiveFrom"),
        ));

    if (effectiveTo) {
      // Rule 1: bounded range -> reject on ANY intersection with the
      // other assignment's coverage (null effectiveTo = running forever).
      const overlapping = others.find((o) => {
        const oStart = o.effectiveFrom;
        const oEnd = o.effectiveTo || "9999-12-31";
        return effectiveFrom <= oEnd && effectiveTo >= oStart;
      });

      if (overlapping) {
        return req.error(
          400,
          `Employee already has a shift assignment overlapping the selected date range${
            overlapping.effectiveTo
              ? ` (${overlapping.effectiveFrom} to ${overlapping.effectiveTo})`
              : ` (from ${overlapping.effectiveFrom}, still active)`
          }. Update the existing assignment instead.`,
        );
      }
      return;
    }

    // Rule 2: indefinite assignment.
    // A later-starting (pinned) assignment still conflicts.
    const pinned = others.find((o) => o.effectiveFrom > effectiveFrom);
    if (pinned) {
      return req.error(
        400,
        `Employee already has a shift assignment starting ${pinned.effectiveFrom}` +
          (pinned.effectiveTo ? ` to ${pinned.effectiveTo}` : "") +
          ` which conflicts with the new indefinite start date ${effectiveFrom}.`,
      );
    }

    // Close every STILL-open-ended assignment that started earlier -
    // the new indefinite assignment supersedes them (history kept).
    for (const o of others.filter(
      (o) => !o.effectiveTo && o.effectiveFrom < effectiveFrom,
    )) {
      const dayBefore = isoDayBefore(effectiveFrom);
      await tx.run(
        UPDATE(ShiftAssignments)
          .set({ effectiveTo: dayBefore })
          .where({ ID: o.ID }),
      );
    }
  }

  // 'YYYY-MM-DD' minus one day, without timezone surprises.
  function isoDayBefore(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  }

  // Raw-UUID-safe key predicate extraction (CAP 8 bound pattern).
  function keysOf(req) {
    const p = req.params?.[0];
    return p ? (typeof p === "object" ? p : { ID: p }) : { ID: req.data?.ID };
  }



// =============
// CREATE
// =============
  srv.before("CREATE", "ShiftAssignments", async (req) => {
    const tx = cds.transaction(req);

    if (!req.data.employee_ID) return req.error(400, "Employee is required");

    if (!req.data.shift_ID) return req.error(400, "Shift is required");

    if (!req.data.effectiveFrom)
      return req.error(400, "Effective date is required");

    if (
      req.data.effectiveTo &&
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
      SELECT.one.from(Shifts).where({ ID: req.data.shift_ID }),
    );

    if (!shift) return req.error(400, "Shift not found");

    // The new assignment must not overlap an existing period; an
    // indefinite assignment supersedes earlier indefinite ones.
    await checkOverlapAndSupersede(
      req,
      tx,
      null,
      req.data.employee_ID,
      req.data.effectiveFrom,
      req.data.effectiveTo,
    );
  });

  // =============
  // UPDATE
  // =============

  srv.before("UPDATE", "ShiftAssignments", async (req) => {
    const tx = cds.transaction(req);

    const current = await tx.run(
      SELECT.one.from(ShiftAssignments).where(keysOf(req)),
    );

    if (!current) return req.error(404, "Shift assignment not found");

    const effectiveFrom = req.data.effectiveFrom ?? current.effectiveFrom;
    const effectiveTo = req.data.effectiveTo ?? current.effectiveTo;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      return req.error(
        400,
        "Effective To must be greater than or equal to Effective From.",
      );
    }

    // The employee cannot be re-pointed to somebody else mid-life.
    if (req.data.employee_ID && req.data.employee_ID !== current.employee_ID) {
      return req.error(
        400,
        "Employee cannot be changed on a shift assignment. Create a new one instead.",
      );
    }

    // Exclude SELF from the overlap check so an UPDATE never
    // collides with its own row.
    await checkOverlapAndSupersede(
      req,
      tx,
      current.ID,
      req.data.employee_ID ?? current.employee_ID,
      effectiveFrom,
      effectiveTo,
    );
  });

  // =============
  // DELETE
  // =============

  srv.before("DELETE", "ShiftAssignments", async (req) => {
    const tx = cds.transaction(req);

    const current = await tx.run(
      SELECT.one.from(ShiftAssignments).where(keysOf(req)),
    );
    if (!current) return req.error(404, "Shift assignment not found");

    // check attendance for THIS employee (the person assigned here,
    // not everyone in the company who ever had an assignment)
    const attendance = await tx.run(
      SELECT.one.from(Attendance).where({ employee_ID: current.employee_ID }),
    );

    if (attendance) {
      return req.error(
        400,
        "Cannot delete Shift Assignment. Attendance records exist for this employee.",
      );
    }

    // check workschedule referencing THIS employee's shift data
    const workSchedule = await tx.run(
      SELECT.one
        .from(WorkSchedule)
        .where({ employee_ID: current.employee_ID }),
    );
    if (workSchedule) {
      return req.error(
        400,
        "Cannot delete Shift Assignment. It is used in Work Schedule.",
      );
    }
  });
};
