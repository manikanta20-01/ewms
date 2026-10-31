// ============================================================
// SPRINT 17 - SHARED DOCUMENTTYPE CATALOG
// ------------------------------------------------------------
// The authoritative vocabulary lives in db/common/enums.cds
// (type DocumentType). The CAP SQLite runtime does not enforce
// enum payload validation on every write path, so the document
// upload (srv/employee/handlers/document.js) and the compliance
// requirement configuration (srv/compliance/handlers/requirements.js)
// validate explicitly against THIS list. Keep it in sync with the
// enum - a mismatch is visible in the compliance computation
// immediately (unfulfillable requirement).
// ============================================================

const DOCUMENT_TYPES = Object.freeze([
  "Aadhar",
  "PAN",
  "Passport",
  "Resume",
  "Degree",
  "AllTypes",
  "EmploymentContract",
  "AddressProof",
  "MedicalCertificate",
  "BackgroundCheck",
]);

module.exports = { DOCUMENT_TYPES };
