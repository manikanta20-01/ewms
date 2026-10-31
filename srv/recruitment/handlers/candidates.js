const cds = require("@sap/cds");
const { generateCode } = require("../../common/utils/code-generator");

// ============================================================
// SPRINT 12 - CANDIDATE HANDLER
// ------------------------------------------------------------
// A candidate is a PERSON BEING RECRUITED - never an employee.
// The Employee entity (Sprint 4) is the only employee master and
// is only filled during onboarding conversion (see
// handlers/employee-conversion.js).
// ============================================================

// Handler registration uses the SERVICE entity name; DB queries
// inside use the full DB entity name (see CANDIDATE_DB below).
const CANDIDATE_ENTITY = "Candidates";
const CANDIDATE_DB = "ewms.db.recruitment.Candidate";

module.exports = (srv) => {
  // Auto business code (CAND0001 ...) - same pattern as EMP000001.
  srv.before("CREATE", CANDIDATE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    req.data.candidateCode = await generateCode(
      req, CANDIDATE_DB, "candidateCode", "CAND", 4,
    );

    // A new candidate always starts in 'New' status regardless of
    // what the caller sends - selection is an explicit HR step.
    if (!req.data.status) req.data.status = "New";

    // Email must be present: it is the natural duplicate-protection
    // key reused during employee conversion.
    if (!req.data.email) {
      return req.error(400, "Candidate email is required.");
    }
  });
};
