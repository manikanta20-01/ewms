const cds = require("@sap/cds");
const { SELECT, INSERT } = cds.ql;

// ============================================================
// SPRINT 16 - GEOFENCE VALIDATOR (reusable backend service)
// ------------------------------------------------------------
// THE one place that decides whether a submitted location is
// acceptable for an attendance operation. Called ONLY from the
// attendance module (srv/attendance/handlers/attendance.js); the
// client never talks to it directly.
//
// WHAT IT GUARANTEES
//   * Coordinates are numbers inside the geographic ranges
//     (lat -90..90, lng -180..180) - malformed / missing / NaN
//     values are rejected with 400 before anything else runs.
//   * A client-declared location time is staleness-checked: older
//     than GEO_MAX_LOCATION_AGE_MINUTES (default 15) or more than
//     5 minutes in the future gets a 400. (No GPS-signalling /
//     anti-spoofing exists or is claimed - ordinary client-
//     supplied coordinates CAN be spoofed; see SPRINT-16.md.)
//   * The evaluation result is ALWAYS computed here. A client
//     cannot pass a Boolean or a status field to claim success -
//     result lives in enums.GeoEvaluationResult and is written
//     only by the recordLocationEvent() helper below.
//   * Failed evaluations reject the attendance request (400) and
//     are transactionally rolled back, so no evidence row with the
//     rejected coordinates is ever persisted.
//
// EVALUATION POLICY (deterministic, documented)
//   1. workLocation 'WorkFromHome'  -> Bypassed (remote-work
//      exception; legitimate off-site work stays possible).
//   2. No ACTIVE + effective geofence at the event date -> Bypassed
//      ('no active geofence configured'). Geofencing is opt-in by
//      configuration - employees are never blocked because no
//      fence exists (B4: do not require a fence unless policy does).
//   3. The employee HAS active eligibility rows covering the date
//      -> only THEY (intersected with step 2) count; if the
//      intersection is empty -> Bypassed 'not eligible...'.
//      No eligibility rows -> every active fence counts (default).
//   4. Otherwise distance (haversine, meters) to the NEAREST fence
//      decides: <= radiusMeters -> Passed, otherwise the request is
//      REJECTED with 400 (the nearest fence is named in the error).
// ============================================================

const LOG = cds.log("geofence");

// Staleness window. A plain constant keeps behavior deterministic in
// every environment; make it an env-tunable only if ops asks for it.
const GEO_MAX_LOCATION_AGE_MINUTES = 15;
const GEO_MAX_FUTURE_DRIFT_MINUTES = 5;

// Tolerance added to the configured radius before the boundary test.
// Distances are computed with double precision; 0.5 m granularity is
// far below GPS accuracy, it only keeps the documented boundary rule
// ("<=" - "outside means strictly greater than radius") stable.
const GEO_BOUNDARY_TOLERANCE_METERS = 0.5;

/** Haversine great-circle distance between two lat/lng pairs, in meters. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // mean Earth radius, meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Round stored evidence coordinates to 4 decimals (~11 m grid).
 * Full-precision client coordinates are deliberately NOT kept.
 */
function roundEvidence(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

/**
 * Validate raw coordinate / timestamp input. Throws a 400 via
 * req.error on any malformed input.
 *
 * @returns {null|{latitude:number, longitude:number, eventTimestamp:Date|null}}
 */
function parseCoordinates(req) {
  const { latitude, longitude, locationTimestamp } = req.data;

  // Neither coordinate provided -> no location evidence at all.
  // Plain (non-geofenced) attendance stays fully supported.
  if (latitude == null && longitude == null) return null;

  // Exactly one coordinate or a non-numeric value -> malformed.
  // req.reject THROWS immediately (req.error would only REGISTER
  // the error and its truthy return value would flow downstream -
  // the explicit throw makes the failure deterministic here).
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    req.reject(400, "Malformed location data: latitude and longitude must both be numbers.");
  }
  if (lat < -90 || lat > 90) {
    req.reject(400, "Invalid location data: latitude must be between -90 and 90.");
  }
  if (lng < -180 || lng > 180) {
    req.reject(400, "Invalid location data: longitude must be between -180 and 180.");
  }

  let ts = null;
  if (locationTimestamp != null) {
    ts = new Date(locationTimestamp);
    if (Number.isNaN(ts.getTime())) {
      req.reject(400, "Malformed location data: locationTimestamp is not a valid timestamp.");
    }
    const now = Date.now();
    const ageMinutes = (now - ts.getTime()) / 60000;
    if (ageMinutes > GEO_MAX_LOCATION_AGE_MINUTES) {
      req.reject(
        400,
        `Stale location data: locationTimestamp is older than ${GEO_MAX_LOCATION_AGE_MINUTES} minutes.`,
      );
    }
    if (ageMinutes < -GEO_MAX_FUTURE_DRIFT_MINUTES) {
      req.reject(400, "Invalid location data: locationTimestamp is too far in the future.");
    }
  }

  return { latitude: lat, longitude: lng, eventTimestamp: ts };
}

/**
 * Persist one AttendanceLocationEvent row (evidence keeper).
 * Coordinates are rounded before storage; the result field is
 * computed by the caller (the validator) - never read from req.data.
 */
async function recordLocationEvent(tx, data) {
  const eventID = cds.utils.uuid();
  await tx.run(
    INSERT.into("ewms.db.geo.AttendanceLocationEvent").entries({
      ID: eventID,
      employee_ID: data.employee_ID,
      attendance_ID: data.attendance_ID || null,
      geofence_ID: data.geofence_ID || null,
      eventType: data.eventType,
      result: data.result,
      eventTimestamp: data.eventTimestamp || null,
      latitude: roundEvidence(data.latitude),
      longitude: roundEvidence(data.longitude),
      distanceMeters: data.distanceMeters ?? null,
      reason: data.reason || null,
    }),
  );
  return eventID;
}

/**
 * Evaluate (and record evidence for) one attendance operation that
 * carried coordinates. See the header comment for the policy.
 *
 * @param {cds.Request} req
 * @param {object} tx        active transaction
 * @param {string} eventType 'CheckIn' | 'CheckOut'
 * @param {object} op
 *   employee_ID, eventDate (ISO date the geofence effectiveness is
 *   evaluated at), workLocation, attendance_ID (optional; on CheckIn
 *   the row does not exist yet), latitude, longitude, eventTimestamp
 * @returns {null|{eventId, result, geofence_ID, distanceMeters, reason}}
 *   null when no coordinates were submitted (nothing to do). eventId
 *   is the evidence row just written (the Attendance handler links
 *   it to the attendance row once that row has an ID).
 */
async function evaluateAttendanceLocation(req, tx, eventType, op) {
  const parsed = parseCoordinates(req);
  if (!parsed) return null;

  const { latitude, longitude, eventTimestamp } = parsed;
  const evidence = { latitude, longitude, eventTimestamp };

  // Step 1 - remote-work exception. Coordinates submitted from a WFH
  // employee are recorded but never enforced: legitimate remote /
  // field work must keep working (B4).
  if (op.workLocation === "WorkFromHome") {
    const eventId = await recordLocationEvent(tx, {
      ...op,
      ...evidence,
      eventType,
      result: "Bypassed",
      reason: "Remote-work exception (WorkFromHome); geofence not enforced.",
    });
    return { eventId, result: "Bypassed", geofence_ID: null, distanceMeters: null, reason: "Remote-work exception" };
  }

  // Step 2 - which fences are active AND effective at the event date?
  const activeFences = await tx.run(
    SELECT.from("ewms.db.geo.Geofence").where({
      status: "Active",
      effectiveFrom: { "<=": op.eventDate },
    }),
  );
  const effectiveFences = activeFences.filter(
    (f) => !f.effectiveTo || f.effectiveTo >= op.eventDate,
  );

  if (effectiveFences.length === 0) {
    const eventId = await recordLocationEvent(tx, {
      ...op,
      ...evidence,
      eventType,
      result: "Bypassed",
      reason: "No active geofence configured for the event date.",
    });
    return {
      eventId,
      result: "Bypassed",
      geofence_ID: null,
      distanceMeters: null,
      reason: "No active geofence configured",
    };
  }

  // Step 3 - employee eligibility narrows the fence set.
  const eligibilities = await tx.run(
    SELECT.from("ewms.db.geo.EmployeeLocationEligibility").where({
      employee_ID: op.employee_ID,
      isActive: true,
      fromDate: { "<=": op.eventDate },
    }),
  );
  const eligibleIds = new Set(
    eligibilities
      .filter((e) => !e.toDate || e.toDate >= op.eventDate)
      .map((e) => e.geofence_ID),
  );

  let candidates = effectiveFences;
  if (eligibleIds.size > 0) {
    candidates = effectiveFences.filter((f) => eligibleIds.has(f.ID));
    if (candidates.length === 0) {
      const eventId = await recordLocationEvent(tx, {
        ...op,
        ...evidence,
        eventType,
        result: "Bypassed",
        reason: "Employee is not eligible for any active geofence.",
      });
      return {
        eventId,
        result: "Bypassed",
        geofence_ID: null,
        distanceMeters: null,
        reason: "Employee not eligible",
      };
    }
  }

  // Step 4 - nearest matching fence decides. Outside the radius the
  // request is REJECTED (transaction rolls back -> evidence rows are
  // never stored for failed evaluations).
  let nearest = null;
  let nearestDistance = Infinity;
  for (const fence of candidates) {
    const d = distanceMeters(latitude, longitude, Number(fence.latitude), Number(fence.longitude));
    if (d < nearestDistance) {
      nearest = fence;
      nearestDistance = d;
    }
  }

  if (nearestDistance <= nearest.radiusMeters + GEO_BOUNDARY_TOLERANCE_METERS) {
    const eventId = await recordLocationEvent(tx, {
      ...op,
      ...evidence,
      eventType,
      result: "Passed",
      geofence_ID: nearest.ID,
      distanceMeters: Math.round(nearestDistance),
    });
    return {
      eventId,
      result: "Passed",
      geofence_ID: nearest.ID,
      distanceMeters: Math.round(nearestDistance),
      reason: null,
    };
  }

  LOG.warn(
    `Geofence rejected: employee ${op.employee_ID} is ${Math.round(nearestDistance)} m from fence ${
      nearest.geofenceCode
    } (radius ${nearest.radiusMeters} m).`,
  );
  // Reject (throw) instead of returning the error: the attendance
  // request must abort here, the transaction rolls back and no
  // evidence row is ever written for the failed evaluation.
  req.reject(
    400,
    `Location rejected: you are ${Math.round(nearestDistance)} m away from geofence "${
      nearest.geofenceCode
    }" (allowed radius ${nearest.radiusMeters} m).`,
  );
}

module.exports = {
  evaluateAttendanceLocation,
  recordLocationEvent,
  distanceMeters,
  GEO_MAX_LOCATION_AGE_MINUTES,
};
