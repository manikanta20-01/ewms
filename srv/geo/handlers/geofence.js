const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");

// ============================================================
// SPRINT 16 - GEOFENCE CONFIGURATION HANDLERS
// ------------------------------------------------------------
// Admin-only configuration maintenance (enforced by geo-security.cds
// grants; these handlers add business validation ON TOP):
//
//   * required fields + coordinate / radius range checks with
//     human-readable messages (the @assert.range annotations are a
//     second belt, the messages here are the suspenders),
//   * auto-generated geofenceCode (GF0001 style, shared generator),
//   * effective window validation (effectiveTo >= effectiveFrom),
//   * status can ONLY be changed through the two bound actions, so
//     every activation/deactivation lands in the history ledger,
//   * DELETE is blocked - fences referenced by evidence rows are
//     history; deactivate instead (retention by design),
//   * every create/update/action writes exactly one GeofenceHistory
//     row (append-only).
// ============================================================

module.exports = (srv) => {
  const { Geofences, EmployeeLocationEligibilities } = srv.entities;
  const Employee = "ewms.db.employee.Employee";

  // ------------------------------------------------------------
  // Conditional, concurrency-safe status changes (the same
  // WHERE status = expected pattern the timesheet lifecycle uses:
  // two racing actions can never both "succeed").
  // ------------------------------------------------------------
  async function changeStatus(req, from, to) {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;

    const current = await tx.run(SELECT.one.from(Geofences).where({ ID: id }));
    if (!current) return req.error(404, "Geofence not found.");

    if (current.status !== from) {
      return req.error(
        409,
        `Geofence is already ${current.status.toLowerCase()}; only ${from.toLowerCase()} fences can be ${to.toLowerCase()}.`,
      );
    }

    // Conditional UPDATE: skipped by a concurrent change -> 409.
    const updated = await tx.run(
      UPDATE(Geofences).set({ status: to }).where({ ID: id, status: from }),
    );
    if (!updated) return req.error(409, "Geofence was changed concurrently; retry.");

    await writeHistory(req, tx, current, to === "Active" ? "Activated" : "Deactivated");
    return `Geofence ${current.geofenceCode} ${to === "Active" ? "activated" : "deactivated"}.`;
  }

  // Write one append-only GeofenceHistory row.
  async function writeHistory(req, tx, geofence, action, changeSummary) {
    await tx.run(
      INSERT.into("ewms.db.geo.GeofenceHistory").entries({
        ID: cds.utils.uuid(),
        geofence_ID: geofence.ID,
        action,
        actorUser: req.user?.id || "system",
        actor_ID: req.user?.attr?.employeeId ?? req.user?.employeeId ?? null,
        actedOn: new Date().toISOString(),
        changeSummary: changeSummary || null,
      }),
    );
  }

  // ------------------------------------------------------------
  // CREATE
  // ------------------------------------------------------------
  srv.before("CREATE", Geofences, async (req) => {
    const tx = cds.transaction(req);
    validateGeoConfig(req, req.data);

    req.data.geofenceCode = await generateCode(req, Geofences, "geofenceCode", "GF", 4);
  });

  srv.after("CREATE", Geofences, async (data, req) => {
    await writeHistory(req, cds.transaction(req), data, "Created");
  });

  // ------------------------------------------------------------
  // UPDATE
  // ------------------------------------------------------------
  srv.before("UPDATE", Geofences, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;

    const current = await tx.run(SELECT.one.from(Geofences).where({ ID: id }));
    if (!current) return req.error(404, "Geofence not found.");

    // Status belongs to the bound actions - keeps the ledger honest.
    if ("status" in req.data) {
      return req.error(400, 'Use the ActivateGeofence/DeactivateGeofence actions to change geofence status.');
    }

    // Validate the MERGED state (PATCH carries only deltas).
    const merged = { ...current, ...req.data };
    validateGeoConfig(req, merged);

    // Remember what changed for the history summary.
    const changed = Object.keys(req.data)
      .filter((f) => !["modifiedAt", "modifiedBy"].includes(f))
      .map((f) => `${f}: ${String(current[f])} -> ${String(req.data[f])}`);

    req._geoHistorySummary = changed.join("; ");
  });

  srv.after("UPDATE", Geofences, async (data, req) => {
    if (!req._geoHistorySummary) return;
    await writeHistory(req, cds.transaction(req), data, "Updated", req._geoHistorySummary);
  });

  // ------------------------------------------------------------
  // DELETE - block; deactivate instead.
  // ------------------------------------------------------------
  srv.before("DELETE", Geofences, async (req) => {
    return req.error(
      400,
      "Geofences cannot be deleted (attendance evidence references them). Deactivate instead.",
    );
  });

  // ------------------------------------------------------------
  // Bound actions
  // ------------------------------------------------------------
  srv.on("ActivateGeofence", Geofences, (req) => changeStatus(req, "Inactive", "Active"));
  srv.on("DeactivateGeofence", Geofences, (req) => changeStatus(req, "Active", "Inactive"));

  // Shared range / window validation for CREATE + UPDATE.
  function validateGeoConfig(req, cfg) {
    if (!cfg.name) req.error(400, "Geofence name is required.");
    if (cfg.latitude == null) req.error(400, "Latitude is required.");
    if (cfg.longitude == null) req.error(400, "Longitude is required.");
    if (cfg.radiusMeters == null) req.error(400, "Radius (meters) is required.");
    if (cfg.effectiveFrom == null) req.error(400, "Effective From date is required.");

    const lat = Number(cfg.latitude);
    const lng = Number(cfg.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      req.error(400, "Latitude must be a number between -90 and 90.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      req.error(400, "Longitude must be a number between -180 and 180.");

    const radius = Number(cfg.radiusMeters);
    if (!Number.isInteger(radius) || radius < 10 || radius > 100000)
      req.error(400, "Radius must be an integer between 10 and 100000 meters.");

    if (cfg.effectiveTo && cfg.effectiveTo < cfg.effectiveFrom)
      req.error(400, "Effective To must be on or after Effective From.");
  }
};
