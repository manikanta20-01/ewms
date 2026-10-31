const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;const { notify } = require("../../notification/handlers/notification-core");

const { persistAudit } = require("../../common/utils/audit");
const {
  POLICY_ENTITY,
  VERSION_ENTITY,
  today,
  ownEmployeeId,
  isHR,
} = require("./policy-common");

// ============================================================
// SPRINT 19 - POLICY HEADER + VERSION LIFECYCLE HANDLERS
// ------------------------------------------------------------
// Beginner summary of the rules implemented here:
//
//   * Direct writes are BLOCKED: PATCH cannot move a lifecycle
//     status and cannot touch published content. Versions are
//     only created via the CreateVersion action and only moved
//     by the bound lifecycle actions. This makes the OData
//     perimeter and the workflow perimeter the same perimeter.
//
//   * The policy HEADER freezes once any version leaves Draft
//     (title/category/applicability included) - changing who a
//     published policy applies to is silently re-scoping it, so
//     a new version must be made instead.
//
//   * Publish supersedes the previously published version by
//     STATUS ONLY - acknowledgment records of the old version
//     are never touched (they point at a version that still
//     exists, so "acknowledged v1" stays provable).
//
//   * Separation of duties: the approver cannot be the person
//     who submitted this version.
//
//   * Workflow-engine note (documented decision): policy
//     approval is a single HR review gate, same shape as the
//     Sprint 18 suggestion review - the generic multi-step
//     WorkflowDefinition engine stays reserved for journey
//     approvals (leave/timesheet). Not a separate framework.
//
//   * Every transition writes an audit row through the shared
//     persistAudit helper (same helper as all other modules).
// ============================================================

const DEFAULT_ACK_STATEMENT =
  "I confirm that I have read and understood this policy and will comply with it.";

module.exports = (srv) => {
  const { Policies, PolicyVersions } = srv.entities;

  // ============================================================
  // POLICY HEADER (CRUD guards)
  // ============================================================
  srv.before("CREATE", Policies, async (req) => {
    const tx = cds.transaction(req);
    const data = req.data;

    if (!data.policyCode) req.reject(400, "Policy code is required.");
    if (!data.title) req.reject(400, "Policy title is required.");
    if (!data.category) req.reject(400, "Policy category is required.");

    // Versions are ONLY created through CreateVersion (a deep
    // nested payload would bypass that validation).
    if (data.versions && (Array.isArray(data.versions)
        ? data.versions.length > 0
        : typeof data.versions === "object")) {
      req.reject(400, "Policy versions are created through the CreateVersion action only.");
    }

    // Unique code: two policies may never share a code.
    const duplicate = await tx.run(
      SELECT.one.from(POLICY_ENTITY).where({ policyCode: data.policyCode }),
    );
    if (duplicate) req.reject(409, `Policy code "${data.policyCode}" already exists.`);

    // Owner: payload may nominate someone, otherwise the caller's
    // own employee record. Callers WITHOUT a linked employee
    // (e.g. SystemAdmin) must nominate one explicitly - a fake
    // default owner would corrupt accountability.
    const ownerId = data.owner_ID || ownEmployeeId(req);
    if (!ownerId) {
      req.reject(400, "A policy owner is required (an owner_ID in the payload, or call from a user linked to an employee).");
    }
    const ownerExists = await tx.run(
      SELECT.one.from("ewms.db.employee.Employee").where({ ID: ownerId }),
    );
    if (!ownerExists) req.reject(404, "Policy owner (employee) not found.");
    data.owner_ID = ownerId;

    // Applicability sanity: a department/country/company scope
    // must reference real rows (404 rather than a dangling FK).
    for (const [field, entityName] of [
      ["applicableCompany_ID", "ewms.db.organization.Company"],
      ["applicableDepartment_ID", "ewms.db.organization.Department"],
    ]) {
      if (data[field]) {
        const row = await tx.run(SELECT.one.from(entityName).where({ ID: data[field] }));
        if (!row) req.reject(404, `Applicability target for ${field} not found.`);
      }
    }

    // Default confirmation sentence (copied to each ack record).
    if (data.requiresAcknowledgment !== false && !data.acknowledgmentStatement) {
      data.acknowledgmentStatement = DEFAULT_ACK_STATEMENT;
    }
  });

  srv.before("UPDATE", Policies, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const versions = await tx.run(
      SELECT.from(VERSION_ENTITY).where({ policy_ID: id }),
    );

    // Freeze the identity/applicability once review started.
    const progressed = versions.some((v) => v.status !== "Draft");
    if (progressed) {
      req.reject(400, "This policy is frozen: a version has left Draft state. Create a new version instead of editing the published/reviewed identity.");
    }

    if (req.data.versions) {
      req.reject(400, "Policy versions are managed through lifecycle actions, not nested PATCHes.");
    }
  });

  srv.before("DELETE", Policies, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const versions = await tx.run(
      SELECT.from(VERSION_ENTITY).where({ policy_ID: id }),
    );
    if (versions.some((v) => v.status !== "Draft")) {
      req.reject(400, "A policy with progressed versions cannot be deleted - archive it instead (audit history is kept).");
    }
  });

  // ============================================================
  // VERSION CREATION + IDENTITY GUARDS
  // ============================================================

  // Anti-bypass perimeter: versions are never created, edited or
  // deleted through ordinary CRUD - only via the actions below.
  srv.before(["CREATE", "UPDATE", "DELETE"], PolicyVersions, (req) => {
    req.reject(
      400,
      "Policy versions are created via CreateVersion and moved via the lifecycle actions (SubmitForReview/Approve/Reject/Publish/Withdraw/Archive). Direct changes are not permitted.",
    );
  });
  srv.before("READ", PolicyVersions, async (req) => {
    // Single-key reads by non-HR callers: only a Published,
    // currently-applicable version may ever be returned as one
    // row (404 otherwise). List reads stay grant-gated and are
    // applicability-filtered after read.
    if (isHR(req)) return;
    const id = req.params?.[0]?.ID ?? req.params?.[0];
    if (id === undefined || id === null) return;

    const tx = cds.transaction(req);
    const version = await tx.run(SELECT.one.from(VERSION_ENTITY).where({ ID: id }));
    if (!version || version.status !== "Published") {
      req.reject(404, "Policy version not found.");
      return;
    }
    const policy = await tx.run(SELECT.one.from(POLICY_ENTITY).where({ ID: version.policy_ID }));
    const { employeeScope, policyAppliesTo } = require("./policy-common");
    const scope = await employeeScope(tx, ownEmployeeId(req));
    if (!policyAppliesTo(policy, scope)) {
      req.reject(404, "Policy version not found.");
    }
  });
  srv.after("READ", PolicyVersions, async (rows, req) => {
    if (isHR(req)) return;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (!list.length) return;

    const tx = cds.transaction(req);
    const { employeeScope, policyAppliesTo } = require("./policy-common");
    const scope = await employeeScope(tx, ownEmployeeId(req));
    const filtered = [];
    for (const row of list) {
      const policy = await tx.run(SELECT.one.from(POLICY_ENTITY).where({ ID: row.policy_ID }));
      if (policyAppliesTo(policy, scope)) filtered.push(row);
    }
    if (Array.isArray(rows)) {
      rows.length = 0;
      rows.push(...filtered);
    }
  });

  // CreateVersion - the ONLY door into a new version.
  srv.on("CreateVersion", Policies, async (req) => {
    const tx = cds.transaction(req);
    const policyId = req.params?.[0]?.ID ?? req.params?.[0];

    const policy = await tx.run(SELECT.one.from(POLICY_ENTITY).where({ ID: policyId }));
    if (!policy) req.reject(404, "Policy not found.");

    // Owner may create drafts for their own policy too.
    const allowed = isHR(req) || String(policy.owner_ID) === String(ownEmployeeId(req));
    if (!allowed) req.reject(403, "Only the policy owner or HR may create versions.");

    const versions = await tx.run(
      SELECT.from(VERSION_ENTITY).where({ policy_ID: policy.ID }).orderBy({ versionNo: "desc" }),
    );

    // Idempotent retries: the same clientRequestId always
    // resolves to the SAME version (no duplicate drafts). NOTE:
    // this check deliberately runs BEFORE the pending-draft
    // guard - a retry with the same token IS the pending draft.
    const token = req.data.clientRequestId
      ? String(req.data.clientRequestId).slice(0, 100)
      : null;
    if (token) {
      const existing = versions.find((v) => v.clientRequestId === token);
      if (existing) return existing.ID;
    }

    // One pending revision at a time: a second Draft/InReview
    // version would fork the approval trail.
    if (versions.some((v) => v.status === "Draft" || v.status === "InReview")) {
      req.reject(409, "This policy already has a Draft/InReview version - complete or reject it first.");
    }

    const latest = versions[0]; // highest versionNo (desc order)
    const versionNo = latest ? latest.versionNo + 1 : 1;

    const content = req.data.content?.trim()
      ? req.data.content
      : latest?.content ?? null;
    const contentReference = req.data.contentReference?.trim()
      ? req.data.contentReference
      : latest?.contentReference ?? null;
    if (!content && !contentReference) {
      req.reject(400, "Provide policy content or a content reference for the new version.");
    }

    let effectiveDate = req.data.effectiveDate ?? latest?.effectiveDate ?? today();
    if (req.data.effectiveDate && req.data.effectiveDate < today()) {
      req.reject(400, "Effective date cannot be in the past.");
    }

    const newId = cds.utils.uuid();
    await tx.run(
      INSERT.into(VERSION_ENTITY).entries({
        ID: newId,
        policy_ID: policy.ID,
        versionNo,
        content,
        contentReference,
        status: "Draft",
        effectiveDate,
        expiryDate: req.data.expiryDate ?? latest?.expiryDate ?? null,
        reviewDate: req.data.reviewDate ?? latest?.reviewDate ?? null,
        clientRequestId: token ?? null,
      }),
    );

    await persistAudit(req, "CreateVersion", "PolicyVersion", null, {
      policy_ID: policy.ID,
      policyCode: policy.policyCode,
      versionNo,
      effectiveDate,
    });

    return newId;
  });

  // ============================================================
  // LIFECYCLE TRANSITIONS (bound actions)
  // ============================================================

  async function loadVersionWithPolicy(tx, req) {
    const versionId = req.params?.[0]?.ID ?? req.params?.[0];
    const version = await tx.run(SELECT.one.from(VERSION_ENTITY).where({ ID: versionId }));
    if (!version) req.reject(404, "Policy version not found.");
    const policy = await tx.run(SELECT.one.from(POLICY_ENTITY).where({ ID: version.policy_ID }));
    if (!policy) req.reject(404, "Policy not found.");
    return { version, policy };
  }

  // Draft -> InReview (owner or HR).
  srv.on("SubmitForReview", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version, policy } = await loadVersionWithPolicy(tx, req);

    const allowed = isHR(req) || String(policy.owner_ID) === String(ownEmployeeId(req));
    if (!allowed) req.reject(403, "Only the policy owner or HR may submit this version for review.");

    if (version.status !== "Draft") {
      req.reject(409, `Version is "${version.status}" - only Draft versions can be submitted for review.`);
    }
    if (!version.content && !version.contentReference) {
      req.reject(400, "A version without content or reference cannot enter review.");
    }

    const submitterId = ownEmployeeId(req) ?? undefined;
    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({
        status: "InReview",
        submittedBy_ID: submitterId,
        submittedOn: new Date().toISOString(),
      }),
    );
    await persistAudit(req, "SubmitForReview", "PolicyVersion", { status: version.status }, { status: "InReview" });

    // Tell the owner when someone else pushed their draft forward.
    if (submitterId && String(policy.owner_ID) !== String(submitterId)) {
      await notify(tx, {
        recipientId: policy.owner_ID,
        title: `Policy ${policy.policyCode} v${version.versionNo} entered review`,
        message: `A version of "${policy.title}" was submitted for review.`,
        category: "POLICY",
        priority: "Medium",
        sourceModule: "POLICY",
        sourceEntity: VERSION_ENTITY,
        sourceRecordId: version.ID,
      });
    }

    return `Version ${version.versionNo} submitted for review.`;
  });

  // InReview -> Approved (approver, not the submitter).
  srv.on("Approve", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version, policy } = await loadVersionWithPolicy(tx, req);

    if (version.status !== "InReview") {
      req.reject(409, `Version is "${version.status}" - only InReview versions can be approved.`);
    }

    const approverId = ownEmployeeId(req) ?? undefined;
    // Separation of duties: whoever submitted cannot approve.
    if (version.submittedBy_ID && String(version.submittedBy_ID) === String(approverId)) {
      req.reject(403, "Separation of duties: the person who submitted this version cannot approve it.");
    }

    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({
        status: "Approved",
        decidedBy_ID: approverId,
        decidedOn: new Date().toISOString(),
        reviewComments: req.data.comments ?? null,
      }),
    );
    await persistAudit(req, "Approve", "PolicyVersion", { status: version.status }, { status: "Approved" });

    await notify(tx, {
      recipientId: policy.owner_ID,
      title: `Policy ${policy.policyCode} v${version.versionNo} approved`,
      message: `Version ${version.versionNo} of "${policy.title}" is approved and ready to publish.`,
      category: "POLICY",
      priority: "Medium",
      sourceModule: "POLICY",
      sourceEntity: VERSION_ENTITY,
      sourceRecordId: version.ID,
    });

    return `Version ${version.versionNo} approved.`;
  });

  // InReview -> Draft (reason required).
  srv.on("Reject", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version } = await loadVersionWithPolicy(tx, req);

    if (version.status !== "InReview") {
      req.reject(409, `Version is "${version.status}" - only InReview versions can be rejected.`);
    }
    if (!req.data.comments || !String(req.data.comments).trim()) {
      req.reject(400, "A rejection reason is required.");
    }

    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({
        status: "Draft", // back to editable draft; content unchanged
        decidedBy_ID: ownEmployeeId(req) ?? undefined,
        decidedOn: new Date().toISOString(),
        reviewComments: String(req.data.comments).slice(0, 500),
      }),
    );
    await persistAudit(req, "Reject", "PolicyVersion", { status: version.status }, { status: "Draft" });
    return `Version ${version.versionNo} sent back to Draft.`;
  });

  // Approved -> Published (supersedes the previous published
  // version by STATUS ONLY; its acknowledgments are preserved).
  srv.on("Publish", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version, policy } = await loadVersionWithPolicy(tx, req);

    if (version.status !== "Approved") {
      req.reject(409, `Version is "${version.status}" - only Approved versions can be published.`);
    }
    if (!version.effectiveDate) {
      req.reject(400, "An effective date is required before publishing.");
    }

    const publisherId = ownEmployeeId(req) ?? undefined;

    // Supersede the currently published version (at most one, but
    // be defensive and supersede all legacy rows).
    const published = await tx.run(
      SELECT.from(VERSION_ENTITY).where({ policy_ID: policy.ID, status: "Published" }),
    );
    for (const oldVersion of published) {
      await tx.run(
        UPDATE(VERSION_ENTITY).where({ ID: oldVersion.ID }).with({ status: "Superseded" }),
      );
    }

    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({
        status: "Published",
        publishedBy_ID: publisherId,
        publishedOn: new Date().toISOString(),
      }),
    );
    await persistAudit(req, "Publish", "PolicyVersion", { status: version.status }, { status: "Published" });

    // One-time announcement to every employee the policy applies
    // to. Dedupe by (recipient, version, title) keeps retries and
    // re-runs from spamming - the notify core plus an explicit
    // existence check per row, same pattern as Sprint 17.
    const { employeeScope, policyAppliesTo } = require("./policy-common");
    const employees = await tx.run(
      SELECT.from("ewms.db.employee.Employee").columns("ID"),
    );
    for (const employee of employees) {
      const scope = await employeeScope(tx, employee.ID);
      if (!scope || !policyAppliesTo(policy, scope)) continue;
      const title = `New HR policy published: ${policy.title} (v${version.versionNo})`;
      const seen = await tx.run(
        SELECT.one
          .from("ewms.db.notification.Notification")
          .where({ recipient_ID: employee.ID, sourceRecordId: version.ID, title }),
      );
      if (seen) continue;
      await notify(tx, {
        recipientId: employee.ID,
        title,
        message: `${policy.title} (version ${version.versionNo}) is effective from ${version.effectiveDate}.`,
        category: "POLICY",
        priority: "Medium",
        sourceModule: "POLICY",
        sourceEntity: VERSION_ENTITY,
        sourceRecordId: version.ID,
      });
    }

    return `Version ${version.versionNo} published (effective ${version.effectiveDate}); previous published version superseded.`;
  });

  // Published -> Withdrawn (reason required).
  srv.on("Withdraw", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version, policy } = await loadVersionWithPolicy(tx, req);

    if (version.status !== "Published") {
      req.reject(409, `Version is "${version.status}" - only Published versions can be withdrawn.`);
    }
    if (!req.data.reason || !String(req.data.reason).trim()) {
      req.reject(400, "A withdrawal reason is required.");
    }

    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({
        status: "Withdrawn",
        withdrawnBy_ID: ownEmployeeId(req) ?? undefined,
        withdrawnOn: new Date().toISOString(),
        withdrawalReason: String(req.data.reason).slice(0, 500),
      }),
    );
    await persistAudit(req, "Withdraw", "PolicyVersion", { status: version.status }, { status: "Withdrawn" });

    await notify(tx, {
      recipientId: policy.owner_ID,
      title: `Policy ${policy.policyCode} v${version.versionNo} withdrawn`,
      message: `"${policy.title}" was withdrawn: ${String(req.data.reason).slice(0, 200)}`,
      category: "POLICY",
      priority: "Medium",
      sourceModule: "POLICY",
      sourceEntity: VERSION_ENTITY,
      sourceRecordId: version.ID,
    });

    return `Version ${version.versionNo} withdrawn.`;
  });

  // Withdrawn -> Archived.
  srv.on("Archive", PolicyVersions, async (req) => {
    const tx = cds.transaction(req);
    const { version } = await loadVersionWithPolicy(tx, req);

    if (version.status !== "Withdrawn") {
      req.reject(409, `Version is "${version.status}" - only Withdrawn versions can be archived.`);
    }
    await tx.run(
      UPDATE(VERSION_ENTITY).where({ ID: version.ID }).with({ status: "Archived" }),
    );
    await persistAudit(req, "Archive", "PolicyVersion", { status: version.status }, { status: "Archived" });
    return `Version ${version.versionNo} archived.`;
  });
};
