const cds = require("@sap/cds");
const { registerAuditHooks } = require("../common/utils/audit");

// ============================================================
// SPRINT 18 - ENGAGEMENT SERVICE IMPLEMENTATION
// ------------------------------------------------------------
// Reuses the shared audit helper; notification writes go through
// the shared notify() core. Both handler files keep the module
// logic (surveys lifecycle/submissions, suggestions/recognition)
// in small focused files, mirroring the compliance module.
// ============================================================
module.exports = cds.service.impl(async function () {
  registerAuditHooks(this, {
    // Audit admin-relevant writes, EXCLUDE SurveyAnswer values -
    // copying confidential individual answers into the audit log
    // would defeat the survey confidentiality design.
    include: [
      "EngagementSurveys",
      "SurveyQuestions",
      "SurveyResponses",
      "Suggestions",
      "Recognitions",
    ],
  });

  require("./handlers/surveys")(this);
  require("./handlers/feedback")(this);
});
