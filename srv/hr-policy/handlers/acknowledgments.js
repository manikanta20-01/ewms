const cds = require("@sap/cds");
const { SELECT, INSERT } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");
const {
  POLICY_ENTITY,
  VERSION_ENTITY,
  ACK_ENTITY,
  today,
  ownEmployeeId,
  isHR,
  employeeScope,
  policyAppliesTo,
} = require("./policy-common");

// ============================================================
// SPRINT 19 - ACKNOWLEDGMENTS, OUTSTANDING VIEW, REMINDERS
// ------------------------------------------------------------
// Beginner summary:
//
//   * An employee acknowledges ONLY a Published, already
//     effective version of a policy that applies to them, and
//     only for themselves (identity is server-set - no acking
//     on behalf of colleagues).
//
//   * Duplicate-safe: the same employee x version can only
//     exist ONCE. A retry returns the existing record instead
//     of creating a second row.
//
//   * Records are numberless/immutable after creation: no
//     direct CREATE (only the action), no UPDATE, no DELETE.
//
//   * New versions never touch old acknowledgments: rows point
//     at the policyVersion they acknowledged, so the fact
//     "acknowledged v1" survives v2 publishing (v1 becomes
//     Superseded, not deleted).
//
//   * OutstandingAcknowledgments is COMPUTED at read time
//     against the CURRENT published version - it can never go
//     stale. HR-only (managers get no employee compliance/
//     acknowledgment data - same line-of-sight as Sprint 17).
//
//   * SendPolicyReminders is a MANUAL, dedupe-safe trigger for
//     an external scheduler: no reminder is ever sent twice for
//     the same recipient + version + title. The repo has no
//     background scheduler, so nothing is claimed to be
//     "scheduled" (documented in SPRINT-19.md).
// ============================================================

module.exports = (srv) => {
  const { PolicyVersions, PolicyAcknowledgments, OutstandingAcknowledgments } = srv.entities;

  // Records only enter the system through the Acknowledge action.
  srv.before("CREATE", PolicyAcknowledgments, (req) => {
    req.reject(400, "Acknowledgments are created through the Acknowledge action only.");
  });
  // Immutable evidence: never editable, never removable.
  srv.before(["UPDATE", "DELETE"], PolicyAcknowledgments, (req) => {
    req.reject(403, "Acknowledgment records are immutable evidence.");
  });

  // ----------------------------------------------------------
  // Acknowledge (bound action on PolicyVersions)
  // ----------------------------------------------------------
  srv.on("Acknowledge", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const employeeId = ownEmployeeId(req);
    if (!employeeId) req.reject(403, "Your user is not linked to an employee record.");

    const versionId = req.params?.[0]?.ID ?? req.params?.[0];
    const version = await tx.run(SELECT.one.from(VERSION_ENTITY).where({ ID: versionId }));
    if (!version) req.reject(404, "Policy version not found.");
    const policy = await tx.run(SELECT.one.from(POLICY_ENTITY).where({ ID: version.policy_ID }));
    if (!policy) req.reject(404, "Policy not found.");

    if (version.status !== "Published") {
      req.reject(400, `Only Published policy versions can be acknowledged (this one is "${version.status}").`);
    }
    if (policy.requiresAcknowledgment === false) {
      req.reject(400, "This policy does not require acknowledgment.");
    }
    const t = today();
    if (version.effectiveDate > t) {
      req.reject(400, `This version takes effect on ${version.effectiveDate} - acknowledgment opens then.`);
    }

    // The caller must be INSIDE the applicability scope.
    const scope = await employeeScope(tx, employeeId);
    if (!scope) req.reject(403, "Employee scope could not be resolved.");
    if (!policyAppliesTo(policy, scope)) {
      req.reject(403, "This policy does not apply to you.");
    }

    // Duplicate-safe retry: same employee x version = same row.
    const existing = await tx.run(
      SELECT.one.from(ACK_ENTITY).where({ employee_ID: employeeId, policyVersion_ID: versionId }),
    );
    if (existing) {
      return `Already acknowledged (record ${existing.ID} on ${existing.acknowledgedOn}). No duplicate created.`;
    }

    const ackId = cds.utils.uuid();
    // Defensive default - the CREATE handler stamps a fixed
    // statement already, but keep a safe fallback identical to it.
    const statement = policy.acknowledgmentStatement ||
      "I confirm that I have read and understood this policy and will comply with it.";
    await tx.run(
      INSERT.into(ACK_ENTITY).entries({
        ID: ackId,
        employee_ID: employeeId,
        policyVersion_ID: versionId,
        acknowledgedOn: new Date().toISOString(),
        acknowledgedStatement: statement,
        // Free-text confirmation metadata supplied by the caller.
        evidenceNote: req.data.statement ? String(req.data.statement).slice(0, 255) : null,
      }),
    );

    return `Acknowledged "${policy.policyCode}" version ${version.versionNo} (record ${ackId}).`;
  });

  // ----------------------------------------------------------
  // OutstandingAcknowledgments (computed, HR-only)
  // ----------------------------------------------------------
  // Status = the CURRENT published + effective version of every
  // acknowledgment-required policy, applied to each employee the
  // policy applies to, minus the acks that already exist.
  //
  // Simple single-column filters are honored (employee_ID,
  // policy_ID) exactly like Sprint 17 compliance reporting.
  srv.on("READ", OutstandingAcknowledgments, async (req) => {
    if (!isHR(req)) req.reject(403, "Outstanding acknowledgment reporting is HR-only.");

    const tx = cds.transaction(req);
    const filterValues = simpleFilterValues(req);

    const employeeRows = await tx.run(
      SELECT.from("ewms.db.employee.Employee").columns(
        "ID", "employeeCode", "firstName", "lastName", "employmentType",
      ),
    );
    const targetEmployees = filterValues.employee_ID
      ? employeeRows.filter((e) => String(e.ID) === String(filterValues.employee_ID))
      : employeeRows;

    const policies = await tx.run(SELECT.from(POLICY_ENTITY).where(filterValues.policy_ID ? { ID: filterValues.policy_ID } : {}));
    const allVersions = await tx.run(SELECT.from(VERSION_ENTITY));
    const allAcks = await tx.run(SELECT.from(ACK_ENTITY));

    const outstanding = [];
    for (const policy of policies) {
      if (policy.requiresAcknowledgment === false) continue;

      // The current published version: statuses make it unique
      // (publishing supersedes the previous one).
      const published = allVersions
        .filter((v) => v.policy_ID === policy.ID && v.status === "Published")
        .sort((a, b) => b.versionNo - a.versionNo)[0];
      if (!published || published.effectiveDate > today()) continue;

      for (const employee of targetEmployees) {
        const scope = await employeeScope(tx, employee.ID);
        if (!scope || !policyAppliesTo(policy, scope)) continue;

        const hasAck = allAcks.some(
          (a) => a.employee_ID === employee.ID && a.policyVersion_ID === published.ID,
        );
        if (hasAck) continue;

        outstanding.push({
          policy_ID: policy.ID,
          employee_ID: employee.ID,
          policyCode: policy.policyCode,
          policyTitle: policy.title,
          category: policy.category,
          policyVersion_ID: published.ID,
          versionNo: published.versionNo,
          effectiveDate: published.effectiveDate,
          reviewDate: published.reviewDate ?? null,
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          employmentType: employee.employmentType,
        });
      }
    }
    return outstanding;
  });

  // ----------------------------------------------------------
  // SendPolicyReminders (manual trigger, dedupe-safe)
  // ----------------------------------------------------------
  srv.on("SendPolicyReminders", async (req) => {
    const tx = cds.transaction(req);
    const daysBefore = Number(req.data.daysBefore);
    const window = Number.isInteger(daysBefore) && daysBefore > 0 ? daysBefore : 30;

    const HONORED = today(); // "today" anchor for the window
    const shiftDays = (isoDate, days) => {
      const d = new Date(`${isoDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    void HONORED;

    let ackReminders = 0;
    let reviewReminders = 0;

    // 1. Outstanding acknowledgment reminders (computed once here,
    //    then deduped per recipient+version+title by existence
    //    check; retries and re-runs never duplicate).
    const outstanding = await outstandingRows(tx);
    for (const row of outstanding) {
      const title = `Action required: acknowledge the ${row.policyTitle} policy (v${row.versionNo})`;
      const seen = await tx.run(
        SELECT.one.from("ewms.db.notification.Notification").where({
          recipient_ID: row.employee_ID,
          sourceRecordId: row.policyVersion_ID,
          title,
        }),
      );
      if (seen) continue;
      await notify(tx, {
        recipientId: row.employee_ID,
        title,
        message: `Version ${row.versionNo} of "${row.policyTitle}" is effective from ${row.effectiveDate}. Please acknowledge it.`,
        category: "POLICY",
        priority: "Medium",
        sourceModule: "POLICY",
        sourceEntity: VERSION_ENTITY,
        sourceRecordId: row.policyVersion_ID,
      });
      ackReminders += 1;
    }

    // 2. Policies whose published version has a reviewDate inside
    //    the window -> remind the policy owner (once per version).
    const versions = await tx.run(
      SELECT.from(VERSION_ENTITY).where({ status: "Published" }),
    );
    const policiesById = new Map(
      (await tx.run(SELECT.from(POLICY_ENTITY))).map((p) => [p.ID, p]),
    );
    const limitDate = shiftDays(HONORED, window);
    for (const version of versions) {
      if (!version.reviewDate || version.reviewDate < HONORED || version.reviewDate > limitDate) continue;
      const policy = policiesById.get(version.policy_ID);
      if (!policy) continue;
      const title = `Policy review due: ${policy.title} (v${version.versionNo}) on ${version.reviewDate}`;
      const seen = await tx.run(
        SELECT.one.from("ewms.db.notification.Notification").where({
          recipient_ID: policy.owner_ID,
          sourceRecordId: version.ID,
          title,
        }),
      );
      if (seen) continue;
      await notify(tx, {
        recipientId: policy.owner_ID,
        title,
        message: `Version ${version.versionNo} of "${policy.title}" is scheduled for review on ${version.reviewDate}.`,
        category: "POLICY",
        priority: "Medium",
        sourceModule: "POLICY",
        sourceEntity: VERSION_ENTITY,
        sourceRecordId: version.ID,
      });
      reviewReminders += 1;
    }

    return `Policy reminder pass complete (window ${window} days): ${ackReminders} outstanding-acknowledgment reminders, ${reviewReminders} review reminders (duplicates suppressed).`;
  });

  // ----------------------------------------------------------
  // shared helpers
  // ----------------------------------------------------------
  const DEFAULT_STATEMENT =
    "I confirm that I have read and understood this policy and will comply with it.";

  async function outstandingRows(tx) {
    const employeeRows = await tx.run(
      SELECT.from("ewms.db.employee.Employee").columns("ID", "employeeCode", "firstName", "lastName", "employmentType"),
    );
    const policies = await tx.run(SELECT.from(POLICY_ENTITY));
    const allVersions = await tx.run(SELECT.from(VERSION_ENTITY));
    const allAcks = await tx.run(SELECT.from(ACK_ENTITY));

    const rows = [];
    for (const policy of policies) {
      if (policy.requiresAcknowledgment === false) continue;
      const published = allVersions
        .filter((v) => v.policy_ID === policy.ID && v.status === "Published")
        .sort((a, b) => b.versionNo - a.versionNo)[0];
      if (!published || published.effectiveDate > today()) continue;
      for (const employee of employeeRows) {
        const scope = await employeeScope(tx, employee.ID);
        if (!scope || !policyAppliesTo(policy, scope)) continue;
        if (allAcks.some((a) => a.employee_ID === employee.ID && a.policyVersion_ID === published.ID)) continue;
        rows.push({
          employee_ID: employee.ID,
          policyVersion_ID: published.ID,
          policyTitle: policy.title,
          versionNo: published.versionNo,
          effectiveDate: published.effectiveDate,
        });
      }
    }
    return rows;
  }

  /** Extract simple "column = value" equality filters from the CQN (best effort, same as Sprint 17). */
  function simpleFilterValues(req) {
    const vals = {};
    const where = req.query?.SELECT?.where;
    if (Array.isArray(where)) {
      for (let i = 0; i < where.length; i++) {
        const part = where[i];
        if (part === "or") break; // only simple and-chains are supported
        if (
          part?.ref?.[0] &&
          where[i + 1] === "=" &&
          where[i + 2]?.val !== undefined
        ) {
          vals[part.ref[0]] = where[i + 2].val;
        }
      }
    }
    return vals;
  }
};
