const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { registerAuditHooks } = require("../common/utils/audit");
const {
  CASE_DB,
  ITEM_DB,
  keysOf,
  actorId,
  isHR,
  recordEvent,
} = require("./handlers/exit-common");

// ============================================================
// SPRINT 21 - EXIT MANAGEMENT (SERVICE IMPL)
// ------------------------------------------------------------
// Wires the three handler files into one service and adds the
// generic audit hooks plus the write-protection guards that make
// a DIRECT PATCH impossible to smuggle a lifecycle change with.
// ============================================================

module.exports = cds.service.impl(async function () {
  const srv = this;

  // 1) Workflow callbacks (the ONLY approval machinery).
  require("./handlers/exit-workflow");

  // 2) Lifecycle + clearance handlers.
  require("./handlers/exit-lifecycle")(srv);
  require("./handlers/exit-clearance")(srv);

  // 3) Generic audit hooks for all five entities (Sprint 16
  //    shared helper; separate events keep the audit trail).
  registerAuditHooks(srv, { include: [
    "ExitCases",
    "ExitChecklistItems",
    "ExitCaseDocuments",
    "ExitEvents",
    "ExitNoticePolicies",
    "ExitClearanceTemplates",
    "ExitClearanceTemplateItems",
  ]});

  // ----------------------------------------------------------
  // DOCUMENT LINK VALIDATION (B8): ExitCaseDocuments point at
  // EXISTING employee documents; they never copy bytes.
  // ----------------------------------------------------------
  srv.before("CREATE", "ExitCaseDocuments", async (req) => {
    const tx = cds.transaction(req);
    const caseId = req.data?.exitCase_ID || (typeof req.params?.[0] === "object" ? req.params?.[0]?.ID : null);
    if (!caseId) return req.reject(400, "exitCase_ID is required.");
    if (!req.data?.document_ID) return req.reject(400, "document_ID is required.");

    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where({ ID: caseId }));
    if (!caseRow) return req.reject(404, "Exit case not found.");

    // Employees link documents only on their OWN case; HR anywhere.
    const me = actorId(req);
    if (!isHR(req) && (!me || me !== caseRow.employee_ID)) {
      return req.reject(403, "You may only link documents to your own exit case.");
    }

    // The document must exist, belong to the case's employee and
    // be Active - a valid paper trail, not an invented record.
    const doc = await tx.run(
      SELECT.one.from("ewms.db.employee.Document").where({ ID: req.data.document_ID }),
    );
    if (!doc) return req.reject(404, "Referenced document does not exist.");
    if (doc.employee_ID !== caseRow.employee_ID) {
      return req.reject(403, "The referenced document does not belong to the departing employee.");
    }
    if (doc.status !== "Active") {
      return req.reject(400, "Only Active documents can be linked to an exit case.");
    }

    req.data.addedBy_ID = req.data.addedBy_ID || me;

    // Idempotent linking: the same document cannot be linked twice.
    const dup = await tx.run(
      SELECT.one.from("ewms.db.exit.ExitCaseDocument").where({
        exitCase_ID: caseId,
        document_ID: req.data.document_ID,
      }),
    );
    if (dup) return req.reject(409, "This document is already linked to the case.");

    await recordEvent(tx, {
      caseId,
      eventType: "DocumentLinked",
      actor: me,
      details: `Document ${req.data.document_ID} linked (required=${req.data.required !== false}).`,
    });
  });

  srv.before("DELETE", "ExitCaseDocuments", async (req) => {
    const tx = cds.transaction(req);
    const keys = keysOf(req);
    const link = await tx.run(
      SELECT.one.from("ewms.db.exit.ExitCaseDocument").where(keys),
    );
    if (!link) return req.reject(404, "Document link not found.");

    const caseRow = await tx.run(SELECT.one.from(CASE_DB).where({ ID: link.exitCase_ID }));
    const me = actorId(req);
    if (!isHR(req) && (!me || me !== caseRow?.employee_ID)) {
      return req.reject(403, "You may only unlink documents from your own exit case.");
    }
    await recordEvent(tx, {
      caseId: link.exitCase_ID,
      eventType: "DocumentUnlinked",
      actor: me,
      details: `Document link ${link.document_ID} removed.`,
    });
  });

  // ----------------------------------------------------------
  // ANTI-BYPASS GUARDS: no grant lets anyone UPDATE an exit case
  // or item, but belt-and-braces: refuse any UPDATE attempt that
  // carries protective fields (matches the workflow engine's
  // guard style), plus refuse DELETE of history rows.
  // ----------------------------------------------------------
  srv.before("UPDATE", "ExitCases", (req) => {
    return req.error(
      403,
      "Exit cases have no direct updates: every lifecycle move goes through the documented actions.",
    );
  });

  srv.before("DELETE", "ExitCases", (req) => {
    return req.error(
      403,
      "Exit cases are never deleted (they are the audit trail of a departure).",
    );
  });

  srv.before("UPDATE", "ExitChecklistItems", (req) => {
    return req.error(
      403,
      "Checklist items are system-seeded and complete only via CompleteItem/SkipItem.",
    );
  });

  srv.before("DELETE", "ExitChecklistItems", (req) => {
    return req.error(403, "Checklist items are never deleted.");
  });

  srv.before("UPDATE", "ExitEvents", (req) => {
    return req.error(403, "Exit events are append-only.");
  });

  srv.before("DELETE", "ExitEvents", (req) => {
    return req.error(403, "Exit events are append-only and cannot be deleted.");
  });
});
