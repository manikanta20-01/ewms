const cds = require("@sap/cds");
const { SELECT } = cds.ql;

// ============================================================
// SPRINT 16 - EMPLOYEE LOCATION ELIGIBILITY HANDLERS
// ------------------------------------------------------------
// Optional restriction of which employees may use a geofence.
// Rules (mirroring the shift-assignment module's overlap guards):
//
//   * employee + geofence must exist,
//   * toDate must be >= fromDate,
//   * NO other ACTIVE eligibility row of the same employee for the
//     same geofence may overlap the new window (UPDATE excluded by
//     self-ID, exactly like ShiftAssignments).
//
// Note the semantics: eligibility rows RESTRICT, they never
// widen. An employee without rows falls back to the default
// permissive policy (all active fences) - see geofence-validator.js.
// ============================================================

module.exports = (srv) => {
  const { EmployeeLocationEligibilities } = srv.entities;
  const Employee = "ewms.db.employee.Employee";

  async function validate(req, tx, excludeId) {
    const { employee_ID, geofence_ID, fromDate, toDate, isActive } = req.data;

    if (!employee_ID) return req.error(400, "Employee is required.");
    if (!geofence_ID) return req.error(400, "Geofence is required.");
    if (!fromDate) return req.error(400, "Effective From date is required.");

    if (toDate && toDate < fromDate)
      return req.error(400, "Effective To must be on or after Effective From.");

    if (!(await tx.run(SELECT.one.from(Employee).where({ ID: employee_ID })))) {
      return req.error(404, "Employee not found.");
    }

    if (!(await tx.run(SELECT.one.from("ewms.db.geo.Geofence").where({ ID: geofence_ID })))) {
      return req.error(404, "Geofence not found.");
    }

    // Overlap guard among ACTIVE rows of the same employee+fence.
    const others = await tx.run(
      SELECT.from(EmployeeLocationEligibilities).where({
        employee_ID,
        geofence_ID,
        isActive: true,
        ...(excludeId ? { ID: { "!=": excludeId } } : {}),
      }),
    );
    const overlapping = others.find((o) => fromDate <= (o.toDate || "9999-12-31") && (!toDate || toDate >= o.fromDate));

    if (overlapping && isActive !== false) {
      return req.error(
        400,
        `Employee already has an active eligibility for this geofence (${overlapping.fromDate}${
          overlapping.toDate ? ` to ${overlapping.toDate}` : ", indefinitely"
        }). Update that row instead.`,
      );
    }
  }

  srv.before("CREATE", EmployeeLocationEligibilities, async (req) => {
    const tx = cds.transaction(req);
    await validate(req, tx, null);
  });

  srv.before("UPDATE", EmployeeLocationEligibilities, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;

    const current = await tx.run(SELECT.one.from(EmployeeLocationEligibilities).where({ ID: id }));
    if (!current) return req.error(404, "Eligibility not found.");

    // Identity linkage is immutable - create a new row instead
    // (keeps the historical config ledger meaningful).
    if ((req.data.employee_ID && req.data.employee_ID !== current.employee_ID)) {
      return req.error(400, "Employee cannot be changed on an eligibility. Create a new one instead.");
    }
    if (req.data.geofence_ID && req.data.geofence_ID !== current.geofence_ID) {
      return req.error(400, "Geofence cannot be changed on an eligibility. Create a new one instead.");
    }

    // Validate the MERGED state.
    req.data.employee_ID = current.employee_ID;
    req.data.geofence_ID = current.geofence_ID;
    await validate(req, tx, id);
  });

  srv.before("DELETE", EmployeeLocationEligibilities, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    if (!(await tx.run(SELECT.one.from(EmployeeLocationEligibilities).where({ ID: id })))) {
      return req.error(404, "Eligibility not found.");
    }
  });
};
