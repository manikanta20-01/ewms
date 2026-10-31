const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { DOCUMENT_TYPES } = require("../../common/utils/document-catalog");

// ============================================================
// SPRINT 17 - DOCUMENT REQUIREMENT CONFIGURATION HANDLERS
// ------------------------------------------------------------
// Beginner summary:
//   * requirementCode is auto-generated (REQ000n style).
//   * documentType MUST be one of the shared DocumentType catalog
//     values - CDS enum validation enforces this at every write.
//   * effectiveTo >= effectiveFrom; expiryAlertDays 0..365.
//   * Status changes go through the Update flow but the row can
//     be deactivated simply by setting status -> Inactive by an
//     admin (documented; requirements have no workflow).
// ============================================================

module.exports = (srv) => {
  const { DocumentRequirements } = srv.entities;
  function validate(req, cfg) {
    if (!cfg.name) req.error(400, "Requirement name is required.");
    if (!cfg.documentType) req.error(400, "Document type is required.");
    // Explicit catalog check - the runtime does not enforce DDL
    // enums on every write path (see common/utils/document-catalog.js).
    if (cfg.documentType && !DOCUMENT_TYPES.includes(cfg.documentType))
      req.error(400, `Unknown document type "${cfg.documentType}" (allowed: ${DOCUMENT_TYPES.join(", ")}).`);
    if (!cfg.effectiveFrom) req.error(400, "Effective From date is required.");

    const alert = cfg.expiryAlertDays;
    if (alert != null && (!Number.isInteger(Number(alert)) || alert < 0 || alert > 365)) {
      req.error(400, "Expiry alert days must be an integer between 0 and 365.");
    }

    if (cfg.effectiveTo && cfg.effectiveTo < cfg.effectiveFrom) {
      req.error(400, "Effective To must be on or after Effective From.");
    }
  }

  srv.before("CREATE", DocumentRequirements, async (req) => {
    validate(req, req.data);
    req.data.requirementCode = await generateCode(
      req,
      DocumentRequirements,
      "requirementCode",
      "REQ",
      4,
    );
  });

  srv.before("UPDATE", DocumentRequirements, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;

    const current = await tx.run(SELECT.one.from(DocumentRequirements).where({ ID: id }));
    if (!current) {
      const e = new Error("Document requirement not found.");
      e.status = 404;
      throw e;
    }

    // Validate the MERGED state (PATCH carries only deltas).
    validate(req, { ...current, ...req.data });
  });

  srv.before("DELETE", DocumentRequirements, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;

    if (!(await tx.run(SELECT.one.from(DocumentRequirements).where({ ID: id })))) {
      const e = new Error("Document requirement not found.");
      e.status = 404;
      throw e;
    }
    // Allow admin delete of unused config rows; historical
    // compliance evidence is stored in the audit log.
  });

  void UPDATE;
};
