const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 12 - RECRUITMENT SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Wires the lifecycle handlers and registers the standard audit
// hooks for all recruitment entities (Sprint 9 audit framework).
// ============================================================

module.exports = cds.service.impl(async function () {
  // Temporary instrumentation only: print whether the db this service
  // uses is the same object we deployed to in the test setup. Remove
  // once the schema-deploy path is confirmed stable.
  try {
    const db = cds.db || this.db;
    console.log(
      `[recruit-svc] db name=${db && db.name} hasRun=${typeof db.run}, instantiated=${db && db.instantiated}, options=${db && db.options && JSON.stringify(db.options)}, constructor=${db && db.constructor && db.constructor.name}`,
    );
  } catch (e) {
    console.log(`[recruit-svc] db probe failed: ${e && e.message}`);
  }

  registerAuditHooks(this, {
    include: [
      "Candidates",
      "Offers",
      "OnboardingChecklists",
      "OnboardingChecklistItems",
      "OnboardingCases",
      "OnboardingTasks",
      "OnboardingDocumentRequirements",
    ],
  });

  require("./handlers/candidates")(this);
  require("./handlers/offer-lifecycle")(this);
  require("./handlers/onboarding-lifecycle")(this);
  require("./handlers/employee-conversion")(this);
});
