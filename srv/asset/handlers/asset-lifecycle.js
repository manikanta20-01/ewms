const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 14 - ASSET LIFECYCLE
// ------------------------------------------------------------
// Implements the asset state machine + the custody (assignment)
// records. ALL state changes go through these actions - a direct
// PATCH can never move status/condition/currentHolder (guard in
// asset-master.js).
//
//   Available --assignAsset--> Assigned --returnAsset--> Available
//        |                          |                or InRepair
//        |                          '--transferAsset--> Assigned
//        |                                             (new employee)
//   Side exits (role-restricted actions):
//     startRepair / completeRepair : Available/Damaged <-> InRepair
//     markLost / markDamaged       : -> Lost / Damaged
//     inspectAsset                 : condition + outcome (recover,
//                                    repair, or route to retire/dispose)
//     retireAsset / disposeAsset   : end of life (blocked while assigned)
//
// Design rules honored here:
//   * History first: assignments are CLOSED, never deleted; every
//     action writes an AssetEvent row. Sprint 21 Exit Management
//     can read per-employee custody + conditions from these rows.
//   * Idempotency: retried actions fail with clear 4xx errors
//     instead of duplicating assignments or returns.
//   * Every action writes an audit row (shared helper) and sends
//     notifications through the SHARED notify() core.
//   * No approval workflow is wired in Sprint 14 (documented
//     extension point - see docs/sprints/SPRINT-14.md).
// ============================================================

const ASSET_ENTITY = "Assets"; // service projection (registration only)
const ASSET_DB = "ewms.db.asset.Asset"; // DB table (queries)
const ASSIGNMENT_DB = "ewms.db.asset.AssetAssignment";
const EVENT_DB = "ewms.db.asset.AssetEvent";
const EMPLOYEE_DB = "ewms.db.employee.Employee";

// Valid values of the controlled scales (db/common/enums.cds).
// Actions accept plain String parameters, so the handler must
// validate them before storing them into the enum-typed columns.
const VALID_CONDITIONS = ["New", "Good", "Fair", "Damaged", "Critical"];
const VALID_OUTCOMES = ["Reusable", "RepairRequired", "RetireRecommended", "DisposeRecommended"];

// Event types stored in AssetEvent.eventType (String constants -
// findable programmatically by Sprint 21 and future automation).
const EVENT = {
  ASSIGNED: "ASSIGNED",
  TRANSFERRED: "TRANSFERRED",
  RETURNED: "RETURNED",
  INSPECTED: "INSPECTED",
  REPAIR_STARTED: "REPAIR_STARTED",
  REPAIR_COMPLETED: "REPAIR_COMPLETED",
  MARKED_LOST: "MARKED_LOST",
  MARKED_DAMAGED: "MARKED_DAMAGED",
  RETIRED: "RETIRED",
  DISPOSED: "DISPOSED",
};

// ------------------------------------------------------------
// Allowed asset status transitions. Everything not listed here
// is rejected with 400 - arbitrary status manipulation can never
// happen. 'Returned' is a legacy enum value that is never set
// (returns are expressed by CLOSING the assignment).
// ------------------------------------------------------------
const ASSET_TRANSITIONS = {
  Available: ["Assigned", "InRepair", "Lost", "Damaged", "Retired", "Disposed"],
  Assigned: ["Available", "InRepair", "Lost", "Damaged"],
  Returned: [],
  InRepair: ["Available", "Retired", "Disposed"],
  Lost: ["Available", "InRepair", "Retired", "Disposed"],
  Damaged: ["Available", "InRepair", "Retired", "Disposed"],
  Retired: ["Disposed"],
  Disposed: [], // final
};

function assertTransition(req, from, to) {
  const allowed = ASSET_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Asset cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/** Raw-UUID-safe key extraction (CAP 8 bound actions - a raw
 *  string in .where() makes CQN parse the UUID as an expression). */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

/** Returns TRUE (and registers the error) when the condition is
 *  invalid - callers `return` immediately so only ONE error is
 *  reported per request (two req.error calls produce the opaque
 *  "Multiple errors occurred" 400). */
function assertCondition(req, condition, what) {
  if (!condition || !VALID_CONDITIONS.includes(condition)) {
    req.error(400, `${what} must be one of: ${VALID_CONDITIONS.join(", ")}.`);
    return true;
  }
  return false;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Append-only history row. Called by EVERY lifecycle action so
 * the asset's story (who had it, when, in which condition) can
 * always be reconstructed - the mandatory requirement shared
 * with Sprint 21 Exit Management.
 */
async function recordEvent(tx, req, { assetId, assignmentId, eventType, fromStatus, toStatus, condition, details }) {
  await tx.run(
    INSERT.into(EVENT_DB).entries({
      ID: cds.utils.uuid(),
      asset_ID: assetId,
      assignment_ID: assignmentId || null,
      eventType,
      eventOn: new Date().toISOString(),
      actor_ID: req.user?.attr?.employeeId || null,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      condition: condition || null,
      details: details || null,
    }),
  );
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // ASSIGN: Available -> Assigned (+ Active assignment row)
  // ----------------------------------------------------------
  srv.on("assignAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");

    // IDEMPOTENCY first: exactly ONE active assignment per asset.
    // A retried call must get the clear 409 (not a confusing
    // transition error from the already-Assigned state).
    const active = await tx.run(
      SELECT.one.from(ASSIGNMENT_DB).where({ asset_ID: asset.ID, status: "Active" }),
    );
    if (active) {
      return req.error(
        409,
        `Asset ${asset.assetTag} is already assigned (active assignment exists). Return or transfer it first.`,
      );
    }

    assertTransition(req, asset.status, "Assigned");

    const employeeId = req.data?.employee_ID;
    if (!employeeId) return req.error(400, "employee_ID is required.");

    // The receiving employee must exist - a dangling assignment
    // would break custody tracking and Exit Management.
    const employee = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: employeeId }));
    if (!employee) return req.error(404, "Employee not found.");

    const condition = req.data?.conditionAtAssignment;
    if (condition && assertCondition(req, condition, "conditionAtAssignment")) return;

    if (req.data?.expectedReturnDate && req.data.expectedReturnDate < today()) {
      return req.error(400, "expectedReturnDate cannot be in the past.");
    }

    const assignmentId = cds.utils.uuid();
    await tx.run(INSERT.into(ASSIGNMENT_DB).entries({
      ID: assignmentId,
      asset_ID: asset.ID,
      employee_ID: employeeId,
      assignedBy_ID: req.user?.attr?.employeeId || null,
      assignmentDate: today(),
      expectedReturnDate: req.data?.expectedReturnDate || null,
      status: "Active",
      conditionAtAssignment: condition || asset.condition,
      notes: req.data?.notes || null,
    }));

    await tx.run(UPDATE(ASSET_DB).set({
      status: "Assigned",
      currentHolder_ID: employeeId,
      condition: condition || asset.condition,
    }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Assigned", currentHolder_ID: employeeId });
    await persistAudit(req, "CREATE", "AssetAssignments", null, {
      asset: asset.assetTag, employee_ID: employeeId, status: "Active",
    });
    await recordEvent(tx, req, {
      assetId: asset.ID, assignmentId, eventType: EVENT.ASSIGNED,
      fromStatus: asset.status, toStatus: "Assigned",
      condition: condition || asset.condition,
      details: `Assigned to employee ${employeeId}.`,
    });

    await notify(cds.transaction(req), {
      recipientId: employeeId,
      title: `Asset ${asset.assetTag} assigned to you`,
      message: `Asset '${asset.name}' (${asset.assetTag}) has been assigned to you. Please acknowledge it.`,
      category: "ASSET",
      priority: "Medium",
      sourceModule: "ASSET",
      sourceEntity: "Asset",
      sourceRecordId: asset.ID,
    });

    return `Asset ${asset.assetTag} assigned (assignment ${assignmentId}).`;
  });

  // ----------------------------------------------------------
  // RETURN: Assigned -> Available (or InRepair when damaged)
  // ----------------------------------------------------------
  srv.on("returnAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");

    // IDEMPOTENCY: a retried return finds no active assignment and
    // fails with 409 instead of creating a second return record.
    const active = await tx.run(
      SELECT.one.from(ASSIGNMENT_DB).where({ asset_ID: asset.ID, status: "Active" }),
    );
    if (!active) {
      return req.error(409, `Asset ${asset.assetTag} has no active assignment - nothing to return.`);
    }

    const condition = req.data?.condition;
    if (assertCondition(req, condition, "condition")) return;

    // A damaged/critical return sends the asset to repair instead
    // of straight back to the pool (business rule).
    const toStatus = condition === "Damaged" || condition === "Critical" ? "InRepair" : "Available";
    assertTransition(req, asset.status, toStatus);

    await tx.run(UPDATE(ASSIGNMENT_DB).set({
      status: "Returned",
      actualReturnDate: today(),
      conditionAtReturn: condition,
    }).where({ ID: active.ID }));

    await tx.run(UPDATE(ASSET_DB).set({
      status: toStatus,
      condition,
      currentHolder_ID: null,
    }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: toStatus, condition });
    await recordEvent(tx, req, {
      assetId: asset.ID, assignmentId: active.ID, eventType: EVENT.RETURNED,
      fromStatus: asset.status, toStatus, condition,
      details: `Returned by employee ${active.employee_ID}.`,
    });

    await notify(cds.transaction(req), {
      recipientId: active.assignedBy_ID || active.employee_ID,
      title: `Asset ${asset.assetTag} returned`,
      message: `Asset '${asset.name}' was returned in condition '${condition}'.`,
      category: "ASSET",
      priority: "Low",
      sourceModule: "ASSET",
      sourceEntity: "Asset",
      sourceRecordId: asset.ID,
    });

    return `Asset ${asset.assetTag} returned; status is now ${toStatus}.`;
  });

  // ----------------------------------------------------------
  // TRANSFER: Assigned(A) -> Assigned(B)
  // Closes A's assignment, opens B's - two history rows, never an
  // employee-ID overwrite.
  // ----------------------------------------------------------
  srv.on("transferAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");

    const newEmployeeId = req.data?.newEmployee_ID;
    if (!newEmployeeId) return req.error(400, "newEmployee_ID is required.");

    const newEmployee = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: newEmployeeId }));
    if (!newEmployee) return req.error(404, "New employee not found.");

    const active = await tx.run(
      SELECT.one.from(ASSIGNMENT_DB).where({ asset_ID: asset.ID, status: "Active" }),
    );
    if (!active) {
      return req.error(409, `Asset ${asset.assetTag} has no active assignment - use assignAsset instead.`);
    }
    if (active.employee_ID === newEmployeeId) {
      return req.error(400, "The asset is already assigned to this employee.");
    }

    const condition = req.data?.condition || asset.condition;
    if (assertCondition(req, condition, "condition")) return;

    // Close the previous custody period (history, not deletion).
    await tx.run(UPDATE(ASSIGNMENT_DB).set({
      status: "Returned",
      actualReturnDate: today(),
      conditionAtReturn: condition,
      notes: `${active.notes || ""} Transferred to another employee.`.trim(),
    }).where({ ID: active.ID }));

    const newAssignmentId = cds.utils.uuid();
    await tx.run(INSERT.into(ASSIGNMENT_DB).entries({
      ID: newAssignmentId,
      asset_ID: asset.ID,
      employee_ID: newEmployeeId,
      assignedBy_ID: req.user?.attr?.employeeId || null,
      assignmentDate: today(),
      status: "Active",
      conditionAtAssignment: condition,
      notes: req.data?.notes || null,
    }));

    await tx.run(UPDATE(ASSET_DB).set({
      currentHolder_ID: newEmployeeId,
      condition,
    }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, {
      transferredTo: newEmployeeId,
      previousAssignment: active.ID,
      newAssignment: newAssignmentId,
    });
    await persistAudit(req, "CREATE", "AssetAssignments", null, {
      asset: asset.assetTag, employee_ID: newEmployeeId, status: "Active",
    });
    await recordEvent(tx, req, {
      assetId: asset.ID, assignmentId: newAssignmentId, eventType: EVENT.TRANSFERRED,
      fromStatus: "Assigned", toStatus: "Assigned", condition,
      details: `Transferred from employee ${active.employee_ID} to ${newEmployeeId}.`,
    });

    await notify(cds.transaction(req), {
      recipientId: newEmployeeId,
      title: `Asset ${asset.assetTag} transferred to you`,
      message: `Asset '${asset.name}' (${asset.assetTag}) has been transferred to you. Please acknowledge it.`,
      category: "ASSET",
      priority: "Medium",
      sourceModule: "ASSET",
      sourceEntity: "Asset",
      sourceRecordId: asset.ID,
    });

    return `Asset ${asset.assetTag} transferred (previous assignment ${active.ID} closed, new assignment ${newAssignmentId}).`;
  });

  // ----------------------------------------------------------
  // INSPECT: condition + outcome; the outcome drives the status.
  // Blocked while ASSIGNED - return the asset first so custody
  // and condition always stay consistent.
  // ----------------------------------------------------------
  srv.on("inspectAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");

    if (asset.status === "Assigned") {
      return req.error(400, "The asset is currently assigned - return it before inspecting.");
    }
    if (asset.status === "Disposed") {
      return req.error(400, "A disposed asset cannot be inspected.");
    }

    const condition = req.data?.condition;
    const outcome = req.data?.outcome;
    if (assertCondition(req, condition, "condition")) return;
    if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
      return req.error(400, `outcome must be one of: ${VALID_OUTCOMES.join(", ")}.`);
    }

    // Outcome -> status: reusable assets return to the pool,
    // repair-required assets enter repair; the retire/dispose
    // recommendations apply the end-of-life states directly (the
    // action itself is HR/asset-admin restricted).
    const toStatus =
      outcome === "Reusable" ? "Available"
      : outcome === "RepairRequired" ? "InRepair"
      : outcome === "RetireRecommended" ? "Retired"
      : "Disposed";
    // Re-inspecting an asset that stays in its current status
    // (e.g. confirming Available) is a legitimate condition
    // refresh - only REAL transitions are guarded.
    if (toStatus !== asset.status) assertTransition(req, asset.status, toStatus);

    await tx.run(UPDATE(ASSET_DB).set({ status: toStatus, condition }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: toStatus, condition, outcome });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.INSPECTED,
      fromStatus: asset.status, toStatus, condition,
      details: `Inspection outcome: ${outcome}.`,
    });

    return `Inspection recorded; asset status is now ${toStatus}.`;
  });

  // ----------------------------------------------------------
  // REPAIR: Available/Damaged/Lost -> InRepair -> Available
  // ----------------------------------------------------------
  srv.on("startRepair", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "InRepair");

    await tx.run(UPDATE(ASSET_DB).set({ status: "InRepair" }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "InRepair" });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.REPAIR_STARTED,
      fromStatus: asset.status, toStatus: "InRepair",
      details: req.data?.notes || (req.data?.vendor ? `Vendor: ${req.data.vendor}.` : null),
    });
    return `Asset ${asset.assetTag} sent to repair.`;
  });

  srv.on("completeRepair", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "Available");

    const condition = req.data?.condition;
    if (assertCondition(req, condition, "condition")) return;

    await tx.run(UPDATE(ASSET_DB).set({ status: "Available", condition }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Available", condition });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.REPAIR_COMPLETED,
      fromStatus: "InRepair", toStatus: "Available", condition,
      details: req.data?.notes ||
        (req.data?.repairCost ? `Repair cost: ${req.data.repairCost}.` : null),
    });
    return `Repair completed; asset ${asset.assetTag} is Available again.`;
  });

  // ----------------------------------------------------------
  // LOST / DAMAGED - controlled side exits (reason mandatory so
  // the status change is never silent).
  // ----------------------------------------------------------
  srv.on("markLost", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "Lost");

    if (!req.data?.reason || !req.data.reason.trim()) {
      return req.error(400, "A reason is required when marking an asset as lost.");
    }

    await tx.run(UPDATE(ASSET_DB).set({ status: "Lost" }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Lost" });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.MARKED_LOST,
      fromStatus: asset.status, toStatus: "Lost",
      details: req.data.reason,
    });

    // Accountability stays with the ACTIVE assignment (it is NOT
    // closed): Exit Management will still show the outstanding
    // asset for the holding employee.
    const active = await tx.run(
      SELECT.one.from(ASSIGNMENT_DB).where({ asset_ID: asset.ID, status: "Active" }),
    );
    if (active) {
      await notify(cds.transaction(req), {
        recipientId: active.employee_ID,
        title: `Asset ${asset.assetTag} reported lost`,
        message: `Asset '${asset.name}' you hold was reported lost. ${req.data.reason}`,
        category: "ASSET",
        priority: "High",
        sourceModule: "ASSET",
        sourceEntity: "Asset",
        sourceRecordId: asset.ID,
      });
    }
    return `Asset ${asset.assetTag} marked as lost.`;
  });

  srv.on("markDamaged", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "Damaged");

    const condition = req.data?.condition;
    if (assertCondition(req, condition, "condition")) return;
    if (!req.data?.reason || !req.data.reason.trim()) {
      return req.error(400, "A reason is required when marking an asset as damaged.");
    }

    await tx.run(UPDATE(ASSET_DB).set({ status: "Damaged", condition }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Damaged", condition });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.MARKED_DAMAGED,
      fromStatus: asset.status, toStatus: "Damaged", condition,
      details: req.data.reason,
    });
    return `Asset ${asset.assetTag} marked as damaged.`;
  });

  // ----------------------------------------------------------
  // END OF LIFE: retire / dispose - never while assigned, never
  // silent (reason mandatory), history preserved (no DELETE).
  // ----------------------------------------------------------
  srv.on("retireAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "Retired");

    if (!req.data?.reason || !req.data.reason.trim()) {
      return req.error(400, "A reason is required when retiring an asset.");
    }

    await tx.run(UPDATE(ASSET_DB).set({ status: "Retired" }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Retired" });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.RETIRED,
      fromStatus: asset.status, toStatus: "Retired",
      details: req.data.reason,
    });
    return `Asset ${asset.assetTag} retired.`;
  });

  srv.on("disposeAsset", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keysOf(req)));
    if (!asset) return req.error(404, "Asset not found.");
    assertTransition(req, asset.status, "Disposed");

    if (!req.data?.reason || !req.data.reason.trim()) {
      return req.error(400, "A reason is required when disposing an asset.");
    }

    await tx.run(UPDATE(ASSET_DB).set({ status: "Disposed" }).where({ ID: asset.ID }));

    await persistAudit(req, "UPDATE", "Assets", asset, { status: "Disposed" });
    await recordEvent(tx, req, {
      assetId: asset.ID, eventType: EVENT.DISPOSED,
      fromStatus: asset.status, toStatus: "Disposed",
      details: req.data.reason,
    });
    return `Asset ${asset.assetTag} disposed.`;
  });

  // ----------------------------------------------------------
  // ACKNOWLEDGE (on AssetAssignments): the receiving employee
  // confirms custody of their OWN active assignment.
  // ----------------------------------------------------------
  srv.on("AcknowledgeAssignment", "AssetAssignments", async (req) => {
    const tx = cds.transaction(req);
    const assignment = await tx.run(SELECT.one.from(ASSIGNMENT_DB).where(keysOf(req)));
    if (!assignment) return req.error(404, "Asset assignment not found.");

    const me = req.user?.attr?.employeeId;
    if (!me || me !== assignment.employee_ID) {
      return req.error(403, "You can only acknowledge your own asset assignments.");
    }
    if (assignment.status !== "Active") {
      return req.error(400, `Only active assignments can be acknowledged (current: '${assignment.status}').`);
    }
    if (assignment.acknowledged) {
      // Idempotent: acknowledging twice changes nothing.
      return "Assignment already acknowledged.";
    }

    await tx.run(UPDATE(ASSIGNMENT_DB)
      .set({ acknowledged: true, acknowledgedOn: new Date().toISOString() })
      .where({ ID: assignment.ID }));

    await persistAudit(req, "UPDATE", "AssetAssignments", assignment, { acknowledged: true });
    return "Asset assignment acknowledged.";
  });
};
