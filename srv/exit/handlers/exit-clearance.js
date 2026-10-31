const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");
const { hasGroup, isSystemAdmin } = require("../../common/auth/authorization");
const {
  CASE_DB,
  ITEM_DB,
  assertTransition,
  keysOf,
  actorId,
  isHR,
  openMandatoryItems,
  recordEvent,
} = require("./exit-common");

// ============================================================
// SPRINT 21 - EXIT CLEARANCE + COMPLETION + SETTLEMENT
// ------------------------------------------------------------
// Clearance lifecycle (all role-gated, all audited):
//
//   StartClearance   Approved -> ClearanceInProgress. Clones the
//                    ACTIVE ExitClearanceTemplate into concrete
//                    items (idempotent: existing itemCodes skip).
//   CompleteItem     completes ONE item after (a) role check and
//                    (b) CATEGORY-keyed evidence verification:
//                      Asset    -> ZERO active asset assignments
//                                  (queried from the Sprint 14
//                                  ledger - the module NEVER
//                                  writes an asset return itself)
//                      Document -> >=1 linked required document
//   SkipItem         HRAdmin/SystemAdmin mark an OPTIONAL item
//                    NotApplicable (mandatory items refuse).
//   ReadyForSeparation ClearanceInProgress -> Ready: refused
//                    while ANY mandatory item is open.
//   CompleteExit     Ready -> Completed: stamps separationDate,
//                    flips the employment status (Employee ->
//                    Inactive + relievingDate) and marks
//                    finalProcessingStatus Completed. Guards:
//                    mandatory clearance re-checked; HR contacts
//                    need SystemAdmin (no generic automation of
//                    HR deactivation).
//   RecordFinalSettlement   Payroll evidence gate; without
//                    evidence it refuses - the module never
//                    claims dues are settled. Retry = no-op.
//
// The Sprint 14 asset module has NO "return asset" action that
// the exit module could call - returns must be performed there
// (returnAsset) first; that is exactly why CompleteItem on an
// Asset item verifies the ledger and 409s while assets remain.
// ============================================================

const TEMPLATE_DB = "ewms.db.exit.ExitClearanceTemplate";
const TEMPLATE_ITEM_DB = "ewms.db.exit.ExitClearanceTemplateItem";
const ASSET_ASSIGNMENT_DB = "ewms.db.asset.AssetAssignment";
const NOTIF_EXIT = "EXIT";

/** Which CAP role(s) may act on an item with the given role. */
function rolesFor(responsibleRole) {
  switch (responsibleRole) {
    case "HR": return ["HRExecutive", "HRAdmin"];
    case "Finance": return ["FinanceManager", "PayrollExecutive"];
    case "ITAdmin": return ["SystemAdmin"]; // no dedicated IT role exists (documented)
    case "Manager": return []; // resolved to the reporting manager (identity check)
    default: return [];
  }
}

/** Can `req` complete an item assigned to responsibleRole? */
async function assertItemAuthorization(req, tx, item, caseRow) {
  if (isSystemAdmin(req)) return; // project-wide bypass role

  const me = actorId(req);
  const allowedRoles = rolesFor(item.responsibleRole);
  if (allowedRoles.some((r) => req.user.is(r))) return;

  if (item.responsibleRole === "Manager") {
    // The case employee's ACTIVE reporting manager - resolved
    // from the LIVE EmployeeAssignment (same source the workflow
    // engine uses), so a stale assignment can never authorize.
    const assignment = await tx.run(
      SELECT.one.from("ewms.db.employee.EmployeeAssignment").where({
        employee_ID: caseRow.employee_ID,
        isActive: true,
      }),
    );
    if (assignment && assignment.reportingManager_ID === me) return;
  }

  // HRAdmin completes anything (deputy rule for stuck exits);
  // plain HRExecutive does NOT (keeps IT/Finance items honest).
  if (req.user.is("HRAdmin")) return;

  return req.error(
    403,
    `You are not authorized to complete this '${item.responsibleRole}' clearance item.`,
  );
}

/**
 * Assets the departing employee still holds (Sprint 14 ledger,
 * read-only). Used BOTH by the computed DepartingEmployeeAssets
 * view and by the Asset clearance-item verification.
 */
async function assetsHeldBy(tx, employeeId) {
  return tx.run(
    SELECT.from(ASSET_ASSIGNMENT_DB).where({
      employee_ID: employeeId,
      status: "Active",
    }),
  );
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // START CLEARANCE: Approved -> ClearanceInProgress + seeding
  // ----------------------------------------------------------
  srv.on("StartClearance", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    assertTransition(req, caseRow.status, "ClearanceInProgress");

    // IDEMPOTENT clone of the ACTIVE template's items (same
    // "template snapshot" idea the Sprint 12 onboarding and the
    // workflow engine use). A retried call skips existing codes
    // instead of duplicating mandatory lines.
    const template = await tx.run(
      SELECT.one.from(TEMPLATE_DB).where({ isActive: true }),
    );
    if (!template) {
      return req.error(
        404,
        "No active ExitClearanceTemplate is configured. Clearance cannot start without a configured checklist (configuration gap, not a defect).",
      );
    }
    const templateItems = await tx.run(
      SELECT.from(TEMPLATE_ITEM_DB).where({ template_ID: template.ID }).orderBy("sequence"),
    );
    if (!templateItems.length) {
      return req.error(404, "The active ExitClearanceTemplate has no items configured.");
    }

    const existing = await tx.run(
      SELECT.from(ITEM_DB).where({ exitCase_ID: caseRow.ID }),
    );
    const existingCodes = new Set(existing.map((i) => i.itemCode));
    let seeded = 0;
    for (const item of templateItems) {
      if (existingCodes.has(item.itemCode)) continue;
      await tx.run(
        cds.ql.INSERT.into(ITEM_DB).entries({
          ID: cds.utils.uuid(),
          exitCase_ID: caseRow.ID,
          itemCode: item.itemCode,
          title: item.title,
          category: item.category,
          responsibleRole: item.responsibleRole,
          mandatory: item.mandatory !== false,
          status: "Pending",
        }),
      );
      seeded += 1;
    }

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "ClearanceInProgress", separationDate: caseRow.approvedFinalWorkingDate })
        .where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "ClearanceStarted",
      actor: actorId(req),
      details: `Checklist seeded from template '${template.name}' (${seeded} item(s) added, ${existing.length} already present).`,
      fromStatus: "Approved",
      toStatus: "ClearanceInProgress",
    });
    await persistAudit(req, "ClearanceStarted", "ewms.db.exit.ExitCase",
      { status: caseRow.status }, { status: "ClearanceInProgress", seeded });

    return `Clearance started for case ${caseRow.exitNumber} (${seeded} new item(s)).`;
  });

  // ----------------------------------------------------------
  // COMPLETE ITEM: role check + evidence check + completion
  // ----------------------------------------------------------
  srv.on("CompleteItem", "ExitChecklistItems", async (req) => {
    const tx = cds.transaction(req);
    const item = await tx.run(SELECT.one.from(ITEM_DB).where(keysOf(req)));
    if (!item) return req.error(404, "Checklist item not found.");

    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where({ ID: item.exitCase_ID }));
    if (!caseRow) return req.error(404, "Exit case not found.");

    // Friendly idempotency: a retry on a completed item is a
    // no-op message, NOT a duplicate event or notification.
    if (item.status === "Complete") {
      return `Item '${item.itemCode}' is already completed - no change made.`;
    }
    if (item.status === "NotApplicable") {
      return req.error(400, `Item '${item.itemCode}' was skipped as not applicable and cannot be completed.`);
    }
    if (!["ClearanceInProgress", "ReadyForSeparation"].includes(caseRow.status)) {
      return req.error(400, `Checklist items can only be completed while clearance is in progress (case is '${caseRow.status}').`);
    }

    await assertItemAuthorization(req, tx, item, caseRow);

    // -------- CATEGORY-KEYED EVIDENCE (B5: "do not mark a
    // clearance item complete merely because an unrelated record
    // exists - verify the underlying record") ------------------
    let evidence = "";
    if (item.category === "Asset") {
      // Proof = NO active assignment rows remain in the Sprint 14
      // ledger. The exit module never writes an asset status of
      // its own; returns must be performed there (returnAsset).
      const outstanding = await assetsHeldBy(tx, caseRow.employee_ID);
      if (outstanding.length > 0) {
        const assetIds = [...new Set(outstanding.map((a) => a.asset_ID).filter(Boolean))];
        const assets = assetIds.length
          ? await tx.run(SELECT.from("ewms.db.asset.Asset").where({ ID: { in: assetIds } }))
          : [];
        const tags = outstanding
          .map((a) => assets.find((asset) => asset.ID === a.asset_ID)?.assetTag ?? String(a.asset_ID))
          .join(", ");
        return req.error(
          409,
          `${outstanding.length} asset(s) are still assigned to the departing employee (${tags}). Return them through the Asset module first - clearance cannot mark assets returned.`,
        );
      }
      evidence = "verified against asset ledger: zero active assignments";
    } else if (item.category === "Document") {
      // Proof = at least one linked REQUIRED document row.
      const docs = await tx.run(
        SELECT.from("ewms.db.exit.ExitCaseDocument").where({ exitCase_ID: caseRow.ID, required: true }),
      );
      if (docs.length === 0) {
        return req.error(
          409,
          "No required exit document is linked to the case yet. Link the required documents (existing employee documents) before completing this item.",
        );
      }
      evidence = `verified against linked documents: ${docs.length} required row(s) present`;
    } else if (item.category === "IT") {
      // The repo has no identity-provider integration: this item
      // is the IT/SystemAdmin's documented-paper confirmation of
      // access revocation work done OUTSIDE the system. It never
      // claims system-level revocation happened automatically.
      evidence = "recorded confirmation by the responsible IT/SystemAdmin role (no external integration simulating success)";
    }

    const me = actorId(req);
    await tx.run(
      UPDATE(ITEM_DB)
        .set({
          status: "Complete",
          completedBy_ID: me,
          completedOn: new Date().toISOString(),
          remarks: req.data?.remarks || null,
        })
        .where({ ID: item.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "ItemCompleted",
      actor: me,
      details: `Item '${item.itemCode}' (${item.category}, ${item.responsibleRole}) completed. ${evidence}.`,
    });
    await persistAudit(req, "ItemCompleted", "ewms.db.exit.ExitChecklistItem",
      { status: item.status }, { status: "Complete", itemCode: item.itemCode });

    // Notify the HR owner that a clearance item moved (if set).
    if (caseRow.hrOwner_ID && caseRow.hrOwner_ID !== me) {
      await notify(tx, {
        recipientId: caseRow.hrOwner_ID,
        title: `Exit ${caseRow.exitNumber}: clearance item completed`,
        message: `Checklist item '${item.itemCode}' was completed by the responsible role.`,
        category: NOTIF_EXIT,
        sourceModule: "EXIT",
        sourceEntity: "ewms.db.exit.ExitCase",
        sourceRecordId: caseRow.ID,
      });
    }

    return `Item '${item.itemCode}' completed. ${evidence}.`;
  });

  // ----------------------------------------------------------
  // SKIP ITEM: optional items only, HRAdmin/SystemAdmin only.
  // ----------------------------------------------------------
  srv.on("SkipItem", "ExitChecklistItems", async (req) => {
    const tx = cds.transaction(req);
    const item = await tx.run(SELECT.one.from(ITEM_DB).where(keysOf(req)));
    if (!item) return req.error(404, "Checklist item not found.");
    if (!req.data?.reason?.trim()) return req.error(400, "A reason is mandatory to skip an item.");
    if (item.mandatory) {
      return req.error(400, `Mandatory item '${item.itemCode}' cannot be skipped.`);
    }
    if (item.status !== "Pending") {
      return req.error(400, `Item '${item.itemCode}' is '${item.status}' and cannot be skipped.`);
    }

    const me = actorId(req);
    await tx.run(
      UPDATE(ITEM_DB)
        .set({ status: "NotApplicable", completedBy_ID: me, completedOn: new Date().toISOString() })
        .where({ ID: item.ID }),
    );
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where({ ID: item.exitCase_ID }));

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "ItemSkipped",
      actor: me,
      reason: req.data.reason,
      details: `Optional item '${item.itemCode}' marked NotApplicable.`,
    });
    await persistAudit(req, "ItemSkipped", "ewms.db.exit.ExitChecklistItem",
      { status: item.status }, { status: "NotApplicable", itemCode: item.itemCode });

    return `Optional item '${item.itemCode}' skipped (reason recorded).`;
  });

  // ----------------------------------------------------------
  // READY FOR SEPARATION: refused while ANY mandatory item is
  // open - required clearance can never be silently bypassed.
  // ----------------------------------------------------------
  srv.on("MarkReadyForSeparation", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    assertTransition(req, caseRow.status, "ReadyForSeparation");

    const openMandatory = await openMandatoryItems(tx, caseRow.ID);
    if (openMandatory.length > 0) {
      const codes = openMandatory.map((i) => i.itemCode).join(", ");
      return req.error(
        409,
        `Case cannot become Ready for Separation: mandatory clearance item(s) still open: ${codes}.`,
      );
    }

    await tx.run(
      UPDATE(CASE_DB)
        .set({ status: "ReadyForSeparation", separationDate: caseRow.approvedFinalWorkingDate })
        .where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "ReadyForSeparation",
      actor: actorId(req),
      details: `All mandatory clearance items verified complete. separationDate=${caseRow.approvedFinalWorkingDate}.`,
      fromStatus: "ClearanceInProgress",
      toStatus: "ReadyForSeparation",
    });
    await persistAudit(req, "ReadyForSeparation", "ewms.db.exit.ExitCase",
      { status: caseRow.status }, { status: "ReadyForSeparation" });

    return `Case ${caseRow.exitNumber} is Ready for Separation (${caseRow.approvedFinalWorkingDate}).`;
  });

  attachCompleteExit(srv);
  attachSettlementAndViews(srv);
};

// ------------------------------------------------------------
// RECORD FINAL SETTLEMENT + COMPUTED DEPARTING ASSETS VIEW
// ------------------------------------------------------------
function attachSettlementAndViews(srv) {
  // --------------------------------------------------------
  // RECORDFINALSETTLEMENT: payroll-role gate WITH EVIDENCE
  // --------------------------------------------------------
  // Rule of the sprint: NEVER claim salary/dues are settled
  // without evidence from the existing Payroll module. Evidence
  // here = a PayrollProcess row of this employee whose payroll
  // PERIOD covers the separation/final-working month and whose
  // status is beyond Pending (Processed/Approved/Published).
  // - No evidence -> 409 (documented gap: the payroll engine has
  //   no dedicated final-settlement capability; see report).
  // - Retried call on a completed record -> friendly no-op.
  // --------------------------------------------------------
  srv.on("RecordFinalSettlement", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    if (caseRow.payrollStatus === "Complete") {
      return "Final settlement for this case was already recorded - no change made.";
    }
    const separationDate = caseRow.separationDate || caseRow.approvedFinalWorkingDate;
    if (!separationDate) {
      return req.error(400, "The case has no separation/final working date yet, so the settlement month cannot be determined.");
    }

    // Reference month = the month that contains the separation date.
    const separation = new Date(`${separationDate}T00:00:00Z`);
    const month = separation.getUTCMonth() + 1;
    const year = separation.getUTCFullYear();

    // Deliberately PLAIN queries instead of a join: two selects
    // are cheap and stay inside every CQN dialect the project
    // compiles for (SQLite today, HANA tomorrow).
    const processes = await tx.run(
      SELECT.from("ewms.db.payroll.PayrollProcess").where({
        employee_ID: caseRow.employee_ID,
        processStatus: { in: ["Processed", "Approved", "Published"] },
      }),
    );
    const periodIds = [...new Set(processes.map((p) => p.payrollPeriod_ID).filter(Boolean))];
    const periods = periodIds.length
      ? await tx.run(
          SELECT.from("ewms.db.payroll.PayrollPeriod").where({
            ID: { in: periodIds },
            month,
            year,
          }),
        )
      : [];
    const evidencePeriods = processes.filter((p) =>
      periods.some((per) => per.ID === p.payrollPeriod_ID),
    );

    if (evidencePeriods.length === 0) {
      return req.error(
        409,
        `No processed/approved payroll process exists for this employee covering ${year}-${String(month).padStart(2, "0")} (the separation month). The exit module does NOT claim dues are settled without payroll evidence - run the payroll processing for the separation month first, then record the settlement again.`,
      );
    }

    const me = actorId(req);
    await tx.run(
      UPDATE(CASE_DB).set({ payrollStatus: "Complete" }).where({ ID: caseRow.ID }),
    );

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "FinalSettlementRecorded",
      actor: me,
      details: `Payroll outcome recorded as Complete with ${evidencePeriods.length} qualifying payroll-process row(s) for the separation month (idempotent thereafter).`,
    });
    await persistAudit(req, "FinalSettlementRecorded", "ewms.db.exit.ExitCase",
      { payrollStatus: caseRow.payrollStatus }, { payrollStatus: "Complete" });

    return `Final settlement recorded on case ${caseRow.exitNumber} (with payroll evidence).`;
  });

  // --------------------------------------------------------
  // DEPARTINGEMPLOYEEASSETS: computed at read from the Sprint 14
  // ledger. HR-only (also enforced here: a skip entity cannot
  // carry a where-scope). Requires $filter case_ID eq <uuid>.
  // --------------------------------------------------------
  srv.on("READ", "DepartingEmployeeAssets", async (req) => {
    if (!isHR(req) && !isSystemAdmin(req)) {
      return req.reject(403, "Departing-employee asset lists are HR-only.");
    }
    // Same simple-filter convention as the Sprint 20 Overdue view
    // (Sprint 19/17 precedent) - plain {ref} = {val} scanning.
    const where = req.query?.SELECT?.where || [];
    let caseId = null;
    for (let i = 0; i < where.length - 2; i += 1) {
      const ref = where[i]?.ref;
      const val = where[i + 2]?.val;
      if (ref && ref[ref.length - 1] === "case_ID" && val != null) {
        caseId = val;
        break;
      }
    }
    if (!caseId) {
      return req.reject(400, "Filter with `case_ID eq <id>` - the view is computed per exit case.");
    }

    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where({ ID: caseId }));
    if (!caseRow) return req.reject(404, "Exit case not found.");

    // The read-only handshake with the Sprint 14 ledger: ACTIVE
    // assignment rows = what the employee still holds; closed
    // rows report their ACTUAL return date and condition. This
    // module never writes any of these fields.
    const assignments = await tx.run(
      SELECT.from(ASSET_ASSIGNMENT_DB).where({
        employee_ID: caseRow.employee_ID,
        status: { in: ["Active", "Returned"] },
      }),
    );
    const assetIds = [...new Set(assignments.map((a) => a.asset_ID).filter(Boolean))];
    const assets = assetIds.length
      ? await tx.run(
          SELECT.from("ewms.db.asset.Asset").where({ ID: { in: assetIds } }),
        )
      : [];
    const assetsById = new Map(assets.map((a) => [a.ID, a]));
    const mapped = assignments
      .map((a) => {
        const asset = assetsById.get(a.asset_ID);
        return {
          exitCase_ID: caseId,
          asset_ID: a.asset_ID,
          assetTag: asset?.assetTag ?? String(a.asset_ID),
          assetName: asset?.name ?? null,
          status: a.status,                       // Active = still held
          assignedOn: a.assignmentDate || null,
          returnedOn: a.actualReturnDate || null, // null = still held
          condition: a.status === "Active"
            ? asset?.condition ?? null
            : a.conditionAtReturn ?? null,
        };
      })
      .sort((a, b) => (a.assetTag > b.assetTag ? 1 : -1));
    return mapped;
  });
}

// ------------------------------------------------------------
// COMPLETE EXIT: attached so the file reads top-down (clearance
// first, irreversible completion last).
// ------------------------------------------------------------
function attachCompleteExit(srv) {
  srv.on("CompleteExit", "ExitCases", async (req) => {
    const tx = cds.transaction(req);
    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where(keysOf(req)));
    if (!caseRow) return req.error(404, "Exit case not found.");

    assertTransition(req, caseRow.status, "Completed");

    // PARANOIA GUARD (B5): re-verify mandatory clearance right
    // where the irreversible consequences are written.
    const openMandatory = await openMandatoryItems(tx, caseRow.ID);
    if (openMandatory.length > 0) {
      const codes = openMandatory.map((i) => i.itemCode).join(", ");
      return req.error(409, `Mandatory clearance item(s) still open: ${codes}.`);
    }

    // B9 guard: never let generic exit automation deactivate an
    // HR contact (DepartmentHR row) without the SystemAdmin.
    const isDeptHr = await tx.run(
      SELECT.one.from("ewms.db.organization.DepartmentHR").where({
        employee_ID: caseRow.employee_ID,
        isActive: true,
      }),
    );
    if (isDeptHr && !isSystemAdmin(req)) {
      return req.error(
        403,
        "The departing employee is an active department HR contact. Its access deactivation must be coordinated by a SystemAdmin (documented guard against generic exit automation disabling HR).",
      );
    }

    const me = actorId(req);
    await tx.run(
      UPDATE(CASE_DB)
        .set({
          status: "Completed",
          separationDate: caseRow.separationDate || caseRow.approvedFinalWorkingDate,
          finalProcessingStatus: "Completed",
          completedOn: new Date().toISOString(),
        })
        .where({ ID: caseRow.ID }),
    );

    // The ONLY employment-status mutation in this module (B9):
    // NOT at submit, NOT at approval - access stays valid while
    // the employee must stay reachable during clearance.
    const employee = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: caseRow.employee_ID }),
    );
    if (employee && employee.status !== "Inactive") {
      await tx.run(
        UPDATE("ewms.db.employee.Employee")
          .set({ status: "Inactive", relievingDate: caseRow.separationDate || caseRow.approvedFinalWorkingDate })
          .where({ ID: caseRow.employee_ID }),
      );
    }

    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "EmploymentDeactivated",
      actor: me,
      details: "Employee.status set to Inactive with relievingDate (exit completion).",
    });
    await recordEvent(tx, {
      caseId: caseRow.ID,
      eventType: "Completed",
      actor: me,
      fromStatus: "ReadyForSeparation",
      toStatus: "Completed",
      details: `Exit processing completed. Payroll status remains '${caseRow.payrollStatus}' until the payroll role records the outcome.`,
    });
    await persistAudit(req, "Completed", "ewms.db.exit.ExitCase",
      { status: caseRow.status, employeeStatus: employee?.status },
      { status: "Completed", employeeStatus: "Inactive" });

    // Notifications: the employee + the HR owner. Message text
    // stays neutral for employer-initiated cases (no reason).
    const neutral = caseRow.exitType === "EmployerInitiated";
    await notify(tx, {
      recipientId: caseRow.employee_ID,
      title: neutral ? `Exit case ${caseRow.exitNumber} completed` : `Your exit case ${caseRow.exitNumber} is completed`,
      message: neutral
        ? "Your exit case has been completed. Contact HR for your final settlement status."
        : `Your exit case ${caseRow.exitNumber} is completed. Separation date: ${caseRow.separationDate || caseRow.approvedFinalWorkingDate}.`,
      category: NOTIF_EXIT,
      priority: "Medium",
      sourceModule: "EXIT",
      sourceEntity: "ewms.db.exit.ExitCase",
      sourceRecordId: caseRow.ID,
    });
    if (caseRow.hrOwner_ID) {
      await notify(tx, {
        recipientId: caseRow.hrOwner_ID,
        title: `Exit ${caseRow.exitNumber} completed`,
        message: `Exit case ${caseRow.exitNumber} completed; employment deactivated at separation.`,
        category: NOTIF_EXIT,
        sourceModule: "EXIT",
        sourceEntity: "ewms.db.exit.ExitCase",
        sourceRecordId: caseRow.ID,
      });
    }

    return `Exit case ${caseRow.exitNumber} completed. Employment deactivated; final payroll processing is pending until recorded with evidence.`;
  });
}

module.exports.attachCompleteExit = attachCompleteExit;
