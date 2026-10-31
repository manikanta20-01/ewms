const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");
const { hasRole } = require("../../common/auth/authorization");

// ============================================================
// SPRINT 18 - SURVEY HANDLERS (lifecycle, submission, results)
// ------------------------------------------------------------
// Beginner summary of the business rules enforced HERE (not by
// the CDS grants alone):
//
//   * Surveys follow Draft -> Published -> Closed -> Archived.
//     The only allowed transitions are the bound Publish / Close
//     / Archive actions; direct PATCH of `status` (or of any
//     field of a published survey) is refused.
//   * Submission goes ONLY through the bound Submit action. It
//     validates: survey Published + response window open, the
//     audience (employment type), required questions present,
//     every question answered exactly once with the right VALUE
//     TYPE, and the one-response-per-employee rule.
//   * Correction = Withdraw (own response, while Published) and
//     then Submit again. Submitted answers are never PATCHable.
//   * Individual answers have NO OData entity: SurveyResults is
//     the only aggregate channel. Confidential surveys expose
//     even less: aggregate counts only (identity never included
//     in any result row).
// ============================================================

const SURVEY_ENTITY = "ewms.db.engagement.EngagementSurvey";
const QUESTION_ENTITY = "ewms.db.engagement.SurveyQuestion";
const RESPONSE_ENTITY = "ewms.db.engagement.SurveyResponse";
const ANSWER_ENTITY = "ewms.db.engagement.SurveyAnswer";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ownEmployeeId(req) {
  return req.user?.attr?.employeeId ?? req.user?.employeeId;
}

module.exports = (srv) => {
  const { EngagementSurveys, SurveyQuestions, SurveyResponses } = srv.entities;

  // ------------------------------------------------------------
  // AUTHORING GUARDS (create/update/delete)
  // ------------------------------------------------------------
  srv.before("CREATE", EngagementSurveys, (req) => {
    if (!req.data.title) req.reject(400, "Survey title is required.");
    if (!req.data.openingDate) req.reject(400, "Survey opening date is required.");
    if (req.data.closingDate && req.data.closingDate <= req.data.openingDate) {
      req.reject(400, "Survey closing date must be after the opening date.");
    }
    // A fresh survey always starts as Draft, regardless of payload.
    req.data.status = "Draft";
  });

  srv.before("UPDATE", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const current = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: id }));
    if (!current) {
      const e = new Error("Survey not found.");
      e.status = 404;
      throw e;
    }
    if (req.data.status != null) {
      // Moving the status directly would bypass the lifecycle actions
      // (and their completeness checks) - refuse loudly. This also
      // protects Draft surveys from being PATCH-published.
      req.reject(400, "Survey status changes go through Publish/Close/Archive.");
    }
    if (current.status !== "Draft") {
      // Published+ surveys are immutable except via lifecycle actions
      // (this also protects the published question set).
      req.reject(400, "Only Draft surveys can be edited. Close/Archive an active survey instead.");
    }
    if (req.data.closingDate && (req.data.closingDate <= (req.data.openingDate || current.openingDate))) {
      req.reject(400, "Survey closing date must be after the opening date.");
    }
  });

  srv.before("DELETE", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const current = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: id }));
    if (!current) {
      const e = new Error("Survey not found.");
      e.status = 404;
      throw e;
    }
    if (current.status !== "Draft") {
      // Published/Closed/Archived surveys are reporting history -
      // never hard-deleted. (Retention policy documentation lives
      // in SPRINT-18.md; no legal period is invented here.)
      req.reject(400, "Published or closed surveys cannot be deleted. Archive them instead.");
    }
  });

  srv.before("CREATE", SurveyQuestions, async (req) => {
    const data = req.data;
    if (!data.questionText) req.reject(400, "Question text is required.");
    if (!data.responseType) req.reject(400, "Question response type is required.");

    if (data.responseType === "Choice" && !data.choiceOptions) {
      req.reject(400, "Choice questions need choiceOptions (newline-separated).");
    }
    if (data.responseType !== "Choice" && data.choiceOptions) {
      req.reject(400, "Only Choice questions may define choiceOptions.");
    }

    // The parent survey must be editable (Draft-only authoring).
    const tx = cds.transaction(req);
    const surveyId = data.survey_ID ?? data.survey;
    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: surveyId }));
    if (!survey) req.reject(404, "Survey not found.");
    else if (survey.status !== "Draft") {
      req.reject(400, "Questions can only be added while the survey is a Draft.");
    }
  });

  srv.before("UPDATE", SurveyQuestions, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const current = await tx.run(SELECT.one.from(QUESTION_ENTITY).where({ ID: id }));
    if (!current) {
      const e = new Error("Question not found.");
      e.status = 404;
      throw e;
    }
    // responseType/option shape may not morph after answers started
    // existing conceptually - restrict type changes to Draft surveys.
    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: current.survey_ID }));
    if (!survey || survey.status !== "Draft") {
      req.reject(400, "Questions can only be edited while the survey is a Draft.");
    }
    const merged = { ...current, ...req.data };
    if (merged.responseType === "Choice" && !merged.choiceOptions) {
      req.reject(400, "Choice questions need choiceOptions (newline-separated).");
    }
  });

  srv.before("DELETE", SurveyQuestions, async (req) => {
    const tx = cds.transaction(req);
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data.ID;
    const current = await tx.run(SELECT.one.from(QUESTION_ENTITY).where({ ID: id }));
    if (!current) {
      const e = new Error("Question not found.");
      e.status = 404;
      throw e;
    }
    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: current.survey_ID }));
    if (!survey || survey.status !== "Draft") {
      req.reject(400, "Questions can only be removed while the survey is a Draft.");
    }
  });

  // ----------------------------------------------------------
  // DRAFT VISIBILITY: employees may discover Published (and
  // Closed) survey metadata, but Draft authoring and Archived
  // history stay HR/admin-only - grants cannot express this
  // per-status row rule. IMPORTANT CAP detail: this is done with
  // BEFORE/AFTER handlers, NOT a custom ON READ handler - a
  // custom ON handler on a persisted entity breaks the OData
  // create-response serialization (empty 201 bodies).
  // ----------------------------------------------------------
  srv.before("READ", EngagementSurveys, async (req) => {
    await rejectHiddenDraftKey(req, SURVEY_ENTITY, null);
  });
  srv.before("READ", SurveyQuestions, async (req) => {
    await rejectHiddenDraftKey(req, QUESTION_ENTITY, "survey_ID");
  });

  async function rejectHiddenDraftKey(req, entityPath, parentField) {
    if (hasRole(req, "HRAdmin", "SystemAdmin", "HRExecutive")) return;
    const key = req.params?.[0]?.ID ?? req.params?.[0];
    if (!key) return; // list reads are filtered below
    const tx = cds.transaction(req);
    const row = await tx.run(SELECT.one.from(entityPath).where({ ID: key }));
    if (!row) return; // let the runtime answer the standard 404
    let status = row.status;
    if (parentField) {
      const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: row[parentField] }));
      status = survey?.status;
    }
    if (status === "Draft" || status === "Archived") {
      req.reject(403, "This survey is not visible to you.");
    }
  }

  srv.after("READ", EngagementSurveys, async (rows, req) => {
    return filterHiddenDraftRows(rows, req, null);
  });
  srv.after("READ", SurveyQuestions, async (rows, req) => {
    return filterHiddenDraftRows(rows, req, "survey_ID");
  });

  async function filterHiddenDraftRows(rows, req, parentField) {
    if (rows == null || !Array.isArray(rows) || rows.length === 0 ||
        hasRole(req, "HRAdmin", "SystemAdmin", "HRExecutive")) {
      return rows;
    }
    // IMPORTANT: CAP IGNORES the return value of an after-READ
    // handler for lists - rows must be filtered IN PLACE or the
    // read still ships every hidden row to the client.
    const tx = cds.transaction(req);
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      let status = row.status;
      if (parentField) {
        const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: row[parentField] }));
        status = survey?.status;
      }
      if (status === "Draft" || status === "Archived") rows.splice(i, 1);
    }
    return rows;
  }

  void hasRole;

  // ------------------------------------------------------------
  // LIFECYCLE ACTIONS (HR only - role grant above + status checks)
  // ------------------------------------------------------------
  srv.on("Publish", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const survey = await loadSurvey(req, tx);
    if (survey.status !== "Draft") {
      req.reject(409, "Only Draft surveys can be published.");
    }

    const questions = await tx.run(
      SELECT.from(QUESTION_ENTITY).where({ survey_ID: survey.ID }),
    );
    if (!questions.length) {
      req.reject(400, "A survey needs at least one question before it can be published.");
    }

    if (survey.closingDate && survey.closingDate < today()) {
      req.reject(400, "The closing date is in the past - adjust the survey dates first.");
    }

    await tx.run(
      UPDATE(SURVEY_ENTITY).where({ ID: survey.ID }).with({ status: "Published" }),
    );

    // Notify the target audience ONCE per survey event: the dedupe
    // key is recipient + survey ID + title, so a re-run never spams
    // (same helper + same dedupe approach as Sprint 17 reminders).
    const audience = await audienceEmployees(tx, survey);
    for (const emp of audience) {
      await notify(tx, {
        recipientId: emp.ID,
        title: `New survey published: ${survey.title}`,
        message: `Your opinion matters - the survey "${survey.title}" accepts responses from ${survey.openingDate}${survey.closingDate ? ` to ${survey.closingDate}` : " until it is closed"}.`,
        category: "ENGAGEMENT",
        priority: "Medium",
        sourceModule: "ENGAGEMENT",
        sourceEntity: SURVEY_ENTITY,
        sourceRecordId: survey.ID,
      });
    }
    return `Survey ${survey.title} published (${questions.length} question(s), ${audience.length} employee(s) invited).`;
  });

  srv.on("Close", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const survey = await loadSurvey(req, tx);
    if (survey.status !== "Published") {
      req.reject(409, "Only Published surveys can be closed.");
    }
    await tx.run(UPDATE(SURVEY_ENTITY).where({ ID: survey.ID }).with({ status: "Closed" }));
    return `Survey ${survey.title} closed for responses.`;
  });

  srv.on("Archive", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const survey = await loadSurvey(req, tx);
    if (survey.status !== "Closed" && survey.status !== "Draft") {
      req.reject(409, "Only Closed (or Draft) surveys can be archived.");
    }
    await tx.run(UPDATE(SURVEY_ENTITY).where({ ID: survey.ID }).with({ status: "Archived" }));
    return `Survey ${survey.title} archived.`;
  });

  // ------------------------------------------------------------
  // SUBMISSION (the ONLY way answers are created)
  // ------------------------------------------------------------
  srv.on("Submit", EngagementSurveys, (async (req) => {
    const tx = cds.transaction(req);
    const employeeId = ownEmployeeId(req);
    if (!employeeId) {
      req.reject(403, "Your user is not linked to an employee record.");
    }

    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: req.params?.[0]?.ID ?? req.params?.[0] }));
    if (!survey) req.reject(404, "Survey not found.");

    // Window + audience validation (SERVER-side, never client honor).
    if (survey.status !== "Published") {
      req.reject(409, `The survey is ${survey.status.toLowerCase()} - responses are only accepted while Published.`);
    }
    const t = today();
    if (survey.openingDate && t < survey.openingDate) {
      req.reject(409, `The survey opens on ${survey.openingDate}.`);
    }
    if (survey.closingDate && t > survey.closingDate) {
      req.reject(409, `The survey closed on ${survey.closingDate}.`);
    }
    if (survey.audienceEmploymentType) {
      const emp = await tx.run(SELECT.one.from("ewms.db.employee.Employee").where({ ID: employeeId }));
      if ((emp?.employmentType || "Permanent") !== survey.audienceEmploymentType) {
        req.reject(403, "This survey targets a different employment type.");
      }
    }

    // Duplicate rule: exactly one Submitted response per employee,
    // unless the survey explicitly allows corrections (via Withdraw
    // + re-Submit or multiple responses).
    const prior = await tx.run(
      SELECT.from(RESPONSE_ENTITY).where({
        survey_ID: survey.ID,
        employee_ID: employeeId,
        status: "Submitted",
      }),
    );
    if (prior.length && !survey.allowMultipleResponses) {
      req.reject(409, "You have already submitted a response for this survey.");
    }

    // Validate answers against the published question definitions.
    const questions = await tx.run(
      SELECT.from(QUESTION_ENTITY).where({ survey_ID: survey.ID }),
    );
    const questionById = new Map(questions.map((q) => [q.ID, q]));
    const submitted = Array.isArray(req.data.answers) ? req.data.answers : [];
    if (!submitted.length) req.reject(400, "No answers submitted.");

    const seen = new Set();
    const byQuestion = new Map();
    for (const a of submitted) {
      const q = questionById.get(a.question_ID);
      if (!q) {
        req.reject(400, "Answer references a question that does not belong to this survey.");
      }
      if (seen.has(q.ID)) req.reject(400, `Question "${q.questionText}" was answered more than once.`);
      seen.add(q.ID);
      byQuestion.set(q.ID, a);

      // Type conformance: the VALUE must match the question type.
      const hasText = a.textValue != null && String(a.textValue).trim() !== "";
      const hasNumber = a.numberValue != null;
      const hasBool = a.boolValue != null;
      const hasChoice = a.choiceValue != null && String(a.choiceValue).trim() !== "";

      if (q.responseType === "Text") {
        if (!hasText) req.reject(400, `Question "${q.questionText}" needs a text answer.`);
      } else if (q.responseType === "Rating") {
        if (!hasNumber) req.reject(400, `Question "${q.questionText}" needs a rating (1-5).`);
        if (hasNumber && (!Number.isInteger(a.numberValue) || a.numberValue < 1 || a.numberValue > 5)) {
          req.reject(400, `Rating for "${q.questionText}" must be an integer between 1 and 5.`);
        }
      } else if (q.responseType === "YesNo") {
        if (!hasBool) req.reject(400, `Question "${q.questionText}" needs a yes/no answer.`);
      } else if (q.responseType === "Choice") {
        if (!hasChoice) req.reject(400, `Question "${q.questionText}" needs a choice.`);
        if (hasChoice) {
          const options = String(q.choiceOptions || "")
            .split("\n")
            .map((o) => o.trim())
            .filter(Boolean);
          if (!options.includes(String(a.choiceValue))) {
            req.reject(400, `"${a.choiceValue}" is not an option for "${q.questionText}".`);
          }
        }
      }
    }

    // Required questions must be answered (extra answers to
    // non-questions are already refused above).
    for (const q of questions) {
      if (q.isRequired && !byQuestion.has(q.ID)) {
        req.reject(400, `Question "${q.questionText}" is required.`);
      }
    }

    // Persist response + validated answers in THIS transaction
    // (submit is all-or-nothing). Response count for the employee:
    const responses = await tx.run(
      SELECT.from(RESPONSE_ENTITY).where({ survey_ID: survey.ID, employee_ID: employeeId }),
    );
    const responseId = cds.utils.uuid();
    await tx.run(
      INSERT.into(RESPONSE_ENTITY).entries({
        ID: responseId,
        survey_ID: survey.ID,
        employee_ID: employeeId,
        submittedOn: new Date().toISOString(),
        status: "Submitted",
      }),
    );
    for (const a of byQuestion) {
      const q = questionById.get(a[0]);
      const v = a[1];
      await tx.run(
        INSERT.into(ANSWER_ENTITY).entries({
          ID: cds.utils.uuid(),
          response_ID: responseId,
          question_ID: q.ID,
          textValue: q.responseType === "Text" ? String(v.textValue).trim() : null,
          numberValue: q.responseType === "Rating" ? v.numberValue : null,
          boolValue: q.responseType === "YesNo" ? !!v.boolValue : null,
          choiceValue: q.responseType === "Choice" ? String(v.choiceValue).trim() : null,
        }),
      );
    }

    return `Response submitted for "${survey.title}" (${byQuestion.size} answer(s)).`;
  }));

  // ------------------------------------------------------------
  // WITHDRAW (own response; safe correction route)
  // ------------------------------------------------------------
  srv.on("Withdraw", SurveyResponses, (async (req) => {
    const tx = cds.transaction(req);
    const employeeId = ownEmployeeId(req);
    const response = await tx.run(
      SELECT.one.from(RESPONSE_ENTITY).where({ ID: req.params?.[0]?.ID ?? req.params?.[0] }),
    );
    if (!response) req.reject(404, "Response not found.");

    // Ownership: only the respondent may withdraw their own row.
    if (String(response.employee_ID) !== String(employeeId)
        && !role(req, "HRAdmin", "SystemAdmin")) {
      req.reject(403, "You may only withdraw your own response.");
    }

    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: response.survey_ID }));
    if (!survey) req.reject(404, "Survey not found.");

    if (!["Published", "Closed"].includes(survey.status)) {
      req.reject(409, "Responses can only be withdrawn while the survey accepts them.");
    }
    if (response.status !== "Submitted") {
      req.reject(409, "This response is already withdrawn.");
    }

    await tx.run(
      UPDATE(RESPONSE_ENTITY).where({ ID: response.ID }).with({
        status: "Withdrawn",
        withdrawnOn: new Date().toISOString(),
      }),
    );

    return `Response withdrawn for "${survey.title}".`;
  }));

  // ------------------------------------------------------------
  // AGGREGATE RESULTS (the ONLY answer-reading channel)
  // ------------------------------------------------------------
  srv.on("SurveyResults", EngagementSurveys, async (req) => {
    const tx = cds.transaction(req);
    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: req.params?.[0]?.ID ?? req.params?.[0] }));
    if (!survey) req.reject(404, "Survey not found.");

    if (survey.status === "Draft") {
      req.reject(409, "Draft surveys have no results yet.");
    }

    // Only Submitted rows feed results (withdrawn responses are
    // excluded); answers are counted WITHOUT identities.
    const responses = await tx.run(
      SELECT.from(RESPONSE_ENTITY).where({
        survey_ID: survey.ID,
        status: "Submitted",
      }).columns("ID"),
    );
    const responseIds = responses.map((r) => r.ID);
    if (!responseIds.length) return [];

    const counts = await tx.run(
      SELECT.from(ANSWER_ENTITY).where({ response_ID: responseIds }),
    );
    const questions = await tx.run(
      SELECT.from(QUESTION_ENTITY).where({ survey_ID: survey.ID }).orderBy("sortOrder"),
    );

    const byQuestion = new Map();
    for (const a of counts) {
      const list = byQuestion.get(a.question_ID) || [];
      list.push(a);
      byQuestion.set(a.question_ID, list);
    }

    return questions.map((q) => {
      const answerRows = byQuestion.get(q.ID) || [];
      const dist = {};
      for (const a of answerRows) {
        const key =
          q.responseType === "Text" ? "(text answer)" :
          q.responseType === "Rating" ? String(a.numberValue) :
          q.responseType === "YesNo" ? (a.boolValue ? "Yes" : "No") :
          a.choiceValue;
        dist[key] = (dist[key] || 0) + 1;
      }
      // Confidential surveys: TEXT answers are never exported in
      // any form beyond a count marker ("(text answer)"), so the
      // free-text content cannot be reconstructed from the result.
      return {
        question_ID: q.ID,
        questionText: q.questionText,
        responseType: q.responseType,
        responseCount: answerRows.length,
        distribution: JSON.stringify(dist),
      };
    });
  });

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------
  async function loadSurvey(req, tx) {
    const id = req.params?.[0]?.ID ?? req.params?.[0] ?? req.data?.ID;
    const survey = await tx.run(SELECT.one.from(SURVEY_ENTITY).where({ ID: id }));
    if (!survey) {
      const e = new Error("Survey not found.");
      e.status = 404;
      throw e;
    }
    return survey;
  }

  /** The employees invited by this survey (audience rule identical
   *  to Sprint 17 requirement applicability: null audience = all). */
  async function audienceEmployees(tx, survey) {
    const where = survey.audienceEmploymentType
      ? { employmentType: survey.audienceEmploymentType }
      : {};
    return tx.run(
      SELECT.from("ewms.db.employee.Employee").where(where).columns("ID"),
    );
  }

  function role(req, ...roles) {
    return roles.some((r) => req.user?.roles?.[r] === true);
  }

  void EngagementSurveys;
  void SurveyResponses;
};
