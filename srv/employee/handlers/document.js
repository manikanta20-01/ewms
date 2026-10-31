const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { assertSelfCreate } = require("../../common/utils/self-write-guard");
const { hasRole } = require("../../common/auth/authorization");
const { DOCUMENT_TYPES } = require("../../common/utils/document-catalog");
const storage = require("../../compliance/document-storage");

// ============================================================
// SPRINT 4 + SPRINT 17 - EMPLOYEE DOCUMENT HANDLERS
// ------------------------------------------------------------
// This module keeps ALL business rules for the Document entity
// (the model lives in db/employee/document.cds - there is no
// second document table anywhere).
//
// Beginner summary of the rule set below:
//
//   * WHO may upload      - an employee may create ONLY their own
//                           documents (assertSelfCreate; a plain
//                           employee targeting another employee_ID
//                           gets 403). HR/manager roles may create
//                           any employee's rows (existing grants).
//   * WHAT may be stored  - only magic-signature-validated
//                           application/pdf, image/png, image/jpeg
//                           bytes of max 10 MB (document-storage.js).
//                           The client's declared mimeType is NEVER
//                           trusted for storage decisions.
//   * Verification        - ONLY through the Verify / Reject bound
//                           actions (HRAdmin + SystemAdmin grants
//                           in employee-security.cds). Direct PATCH
//                           of any verification field is refused -
//                           the old (broken) `user.is("HR")` patch
//                           path is gone; there is no role named
//                           "HR" in this system.
//   * Lifecycle           - Active -> Archived via the Archive
//                           action. Deletion is never possible
//                           (retention). Replacement = Archive the
//                           old Active row, then upload a new one
//                           (the duplicate guard only blocks a
//                           SECOND Active row of the same type).
//   * Download            - via the Download bound action: owner
//                           or HRAdmin/SystemAdmin only; the stored
//                           bytes are returned base64-encoded in the
//                           action result. The storage key (filePath)
//                           is never sent to clients (masked below).
// ============================================================

module.exports = async (srv) => {
  const db = await cds.connect.to("db");
  const { Employee, Document } = cds.entities("ewms.db.employee");

  // Raw-UUID-safe key extraction (same pattern as every handler).
  function keysOf(req) {
    const p = req.params?.[0];
    return p ? (typeof p === "object" ? p : { ID: p }) : { ID: req.data?.ID };
  }

  async function loadDocument(req, tx) {
    const doc = await tx.run(SELECT.one.from(Document).where(keysOf(req)));
    if (!doc) {
      const e = new Error("Document not found.");
      e.status = 404;
      throw e;
    }
    return doc;
  }

  /**
   * CAP delivers Edm.Binary payload properties as a Node STREAM
   * (Readable), not a Buffer - collect it before validation. The
   * cds.test harness sends base64 JSON; the OData adapter decodes
   * it and hands the handler a stream either way.
   */
  async function streamToBuffer(content) {
    if (content == null) return null;
    if (Buffer.isBuffer(content)) return content;
    if (typeof content === "string") return Buffer.from(content, "base64");
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  // ------------------------------------------------------------
  // CREATE - upload (metadata, optionally with real file content)
  // ------------------------------------------------------------
  srv.before("CREATE", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const { employee_ID, documentType, documentNumber, fileName, mimeType, fileSize, expiryDate, issueDate } = req.data;

    // Self-service CREATE guard: WHERE clauses filter READs only,
    // so an explicit ownership check is required for CREATE.
    // req.reject THROWS -> deterministic single messages.
    await assertSelfCreate(req, "employee_ID");

    // Required metadata (rejections throw; CAP aggregates the rest
    // of this validation otherwise - we fail in priority order).
    if (!employee_ID) req.reject(400, "Employee is required.");
    if (!documentType) req.reject(400, "Document Type is required.");
    if (!fileName) req.reject(400, "File Name is required.");
    if (!mimeType && !req.data.content) req.reject(400, "Mime Type is required.");

    // The type must be from the shared catalog (the runtime does
    // not enforce DDL enums on every write path - see
    // common/utils/document-catalog.js).
    if (!DOCUMENT_TYPES.includes(documentType))
      req.reject(400, `Unknown document type "${documentType}" (allowed: ${DOCUMENT_TYPES.join(", ")}).`);

    // Employee must exist (lookup WITHOUT a status predicate: the
    // seed data stores a boolean in the status column, and the
    // attendance handlers perform the exact same ID-only lookup -
    // the previous {ID, status:'Active'} variant never matched and
    // made uploads impossible). Ownership itself is enforced above.
    const employee = await tx.run(SELECT.one.from(Employee).where({ ID: employee_ID }));
    if (!employee) req.reject(404, "Employee not found.");

    // Duplicate guard, retry-safe: exactly ONE Active document per
    // employee + TYPE (a renewed PAN with a new number is still a
    // NEW version of the same requirement - archive the old row
    // first). Archived/Replaced rows do not count: replacement =
    // archive old, upload new.
    const duplicate = await tx.run(
      SELECT.one.from(Document).where({ employee_ID, documentType, status: "Active" }),
    );
    if (duplicate) {
      req.reject(
        400,
        "Document already exists (an Active document of this type exists). Archive it first to upload a replacement.",
      );
    }

    // Declared size sanity (the authoritative size check on real
    // bytes runs inside storage.saveFile).
    if (fileSize && fileSize > storage.MAX_DOCUMENT_FILE_SIZE) {
      req.reject(400, "Maximum file size is 10 MB.");
    }

    // Date hygiene.
    if (expiryDate && issueDate && expiryDate < issueDate) {
      req.reject(400, "Expiry Date must be on or after the Issue Date.");
    }

    // ----------------------------------------------------------
    // CONTENT UPLOAD (Sprint 17): validate + persist OUTSIDE the
    // database, store only the storage key + real metadata.
    // ----------------------------------------------------------
    if (req.data.content != null) {
      const raw = await streamToBuffer(req.data.content);
      let meta;
      try {
        meta = storage.saveFile(raw, fileName, fileSize);
      } catch (err) {
        return req.reject(err.status || 400, err.message);
      }
      req.data.filePath = meta.key; // storage key, never a public path
      req.data.mimeType = meta.mimeType; // SNIFFED from the bytes
      req.data.fileSize = meta.fileSize;
      req.data.sha256 = meta.sha256;
      req.data.fileName = meta.fileName; // sanitized, traversal-free
      req.data.content = undefined; // never persisted
    }

    // Verification defaults - verification is HR work through the
    // Verify/Reject actions, a fresh upload is always Pending.
    req.data.verified = false;
    req.data.verifiedBy = null;
    req.data.verifiedOn = null;
    req.data.verificationStatus = "Pending";
  });

  // ------------------------------------------------------------
  // UPDATE - metadata corrections only
  // ------------------------------------------------------------
  srv.before("UPDATE", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDocument(req, tx);

    // Protected fields: lifecycle + verification + identity +
    // storage all move through dedicated actions or new uploads.
    if ("content" in req.data)
      req.reject(400, "Document content cannot be replaced by PATCH. Archive this document and upload a new one.");
    if ("employee_ID" in req.data && req.data.employee_ID !== doc.employee_ID)
      req.reject(400, "Employee cannot be changed on a document.");
    if ("status" in req.data)
      req.reject(400, "Document status changes go through the Archive action (or a replacement upload).");
    for (const f of ["verified", "verificationStatus", "verifiedOn", "verifiedBy", "verificationNotes"]) {
      if (f in req.data)
        req.reject(400, "Verification goes through the Verify/Reject actions (HR only).");
    }
    if ("filePath" in req.data || "sha256" in req.data)
      req.reject(400, "Storage metadata is system-managed.");

    // Metadata fields remain HR-admin editable (expiry/remarks...).
  });

  // ------------------------------------------------------------
  // DELETE - never (retention; audit history references the rows)
  // ------------------------------------------------------------
  srv.before("DELETE", "Documents", async (req) => {
    req.error(400, "Documents cannot be deleted. Archive them instead.");
  });

  // ------------------------------------------------------------
  // After READ: mask the storage key. filePath is an internal,
  // content-addressed KEY - leaking it would let clients attempt
  // storage probing; bytes are only ever served via Download.
  // ------------------------------------------------------------
  srv.after("READ", "Documents", (data) => {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) if (row && "filePath" in row) row.filePath = null;
  });

  // ============================================================
  // BOUND ACTIONS (Sprint 17 verification + lifecycle + download)
  // ============================================================

  srv.on("Verify", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDocument(req, tx);

    if (doc.verificationStatus === "Verified")
      return req.reject(409, "Document is already verified.");
    if (doc.verificationStatus === "Rejected")
      return req.reject(409, "Document was rejected; a new upload is required.");

    await tx.run(
      UPDATE(Document)
        .set({
          verificationStatus: "Verified",
          // Legacy boolean kept in sync for existing consumers.
          verified: true,
          verifiedBy: req.user?.id || "system",
          verifiedOn: new Date().toISOString(),
          verificationNotes: req.data.comments || null,
        })
        .where({ ...keysOf(req), verificationStatus: "Pending" }), // conditional: no concurrent re-verify
    );
    return `Document verified by ${req.user?.id || "system"}.`;
  });

  srv.on("Reject", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDocument(req, tx);

    // A rejection proves non-compliance -> the reason is mandatory
    // (mirrors Reject in the timesheet / offer lifecycles).
    if (!req.data.comments)
      return req.reject(400, "A rejection reason is required.");
    if (doc.verificationStatus !== "Pending")
      return req.reject(409, "Only Pending documents can be rejected.");

    await tx.run(
      UPDATE(Document)
        .set({
          verificationStatus: "Rejected",
          verificationNotes: req.data.comments,
        })
        .where({ ...keysOf(req), verificationStatus: "Pending" }),
    );
    return "Document rejected. The employee must upload a corrected document.";
  });

  srv.on("Archive", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDocument(req, tx);

    if (doc.status !== "Active")
      return req.reject(409, "Only Active documents can be archived.");

    await tx.run(
      UPDATE(Document)
        .set({ status: "Archived" })
        .where({ ...keysOf(req), status: "Active" }),
    );
    return "Document archived. It is now historical (retention kept), no longer compliance-countable.";
  });

  srv.on("Download", "Documents", async (req) => {
    const tx = cds.transaction(req);
    const doc = await loadDocument(req, tx);

    // Authorization boundary for the bytes (the metadata READ
    // grants do not automatically cover file content):
    const own = String(doc.employee_ID) === String(req.user?.attr?.employeeId ?? req.user?.employeeId);
    if (!own && !hasRole(req, "HRAdmin", "SystemAdmin")) {
      return req.reject(403, "You may only download your own documents.");
    }

    if (!doc.filePath)
      return req.reject(400, "This document has no stored content (metadata only).");

    let buf;
    try {
      buf = storage.readFile(doc.filePath);
    } catch (err) {
      return req.reject(err.status || 404, err.message);
    }
    return {
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      sha256: doc.sha256,
      content: buf.toString("base64"),
    };
  });
};
