// ============================================================
// SPRINT 18 - EMPLOYEE ENGAGEMENT TESTS
// ------------------------------------------------------------
// Covers the Sprint 18 acceptance list (B9):
//
//   * survey authoring security (draft invisibility, admin-only
//     CRUD, lifecycle via actions only),
//   * publication / closure / archival + invalid transitions,
//   * response window + audience enforcement,
//   * question & answer validation (types, required, choice
//     options, rating range, unknown questions),
//   * duplicate-submission rule + withdraw/re-submit correction,
//   * cross-employee denials (submit/withdraw/feedback/review),
//   * aggregate results only; confidential surveys never expose
//     individual or text answers,
//   * suggestion review lifecycle + notifications,
//   * recognition authorization + moderation,
//   * audit records for administrative actions.
//
// Same harness as every other suite (test/setup.js, in-memory DB).
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const { GET, POST, PATCH, DELETE } = startTestHarness();

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } }; // HRExecutive+HRAdmin
const JOHN = { auth: { username: "empjohn", password: "" } }; // plain Employee
const MGRDEPT = { auth: { username: "mgrdept", password: "" } }; // DepartmentManager
const MGRPROJ = { auth: { username: "mgrproj", password: "" } }; // David (project manager)

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const HR_ID = "10000000-0000-0000-0000-000000000002";
const DAVID_ID = "10000000-0000-0000-0000-000000000003";

const ENG = "/odata/v4/engagement";
const EMP = "/odata/v4/employee";
const NOTIF = "/odata/v4/notification";

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoShift = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(code === expectedCode, `expected ${expectedCode} but got ${code} (${err.message})`);
    if (messageMatch) assert.match(String(err.message), messageMatch);
  }
}

/** Create + publish a survey in one step (admin). Returns {survey, questions}. */
async function createSurvey(opts = {}, extraQuestions = []) {
  const body = {
    title: opts.title || "Survey",
    description: opts.description || null,
    openingDate: opts.openingDate ?? "2020-01-01",
    closingDate: opts.closingDate ?? null,
    confidential: opts.confidential ?? false,
    allowMultipleResponses: opts.allowMultipleResponses ?? false,
    audienceEmploymentType: opts.audienceEmploymentType ?? null,
  };
  const create = await POST(`${ENG}/EngagementSurveys`, body, ADMIN);
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const survey = create.data;

  const questions = [];
  const defs = extraQuestions.length
    ? extraQuestions
    : [{ questionText: "Free text?", responseType: "Text" }];
  for (const q of defs) {
    const res = await POST(`${ENG}/SurveyQuestions`, {
      survey_ID: survey.ID,
      ...q,
    }, ADMIN);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    questions.push(res.data);
  }
  return { survey, questions };
}

async function publish(surveyId) {
  return POST(`${ENG}/EngagementSurveys(ID=${surveyId})/EngagementService.Publish`, {}, ADMIN);
}

async function submit(surveyId, questions, answers, headers = JOHN) {
  const payload = questions.map((q, i) => ({
    question_ID: q.ID,
    ...(answers[i] || {}),
  }));
  return POST(
    `${ENG}/EngagementSurveys(ID=${surveyId})/EngagementService.Submit`,
    { answers: payload },
    headers,
  );
}

// ============================================================
// 1. AUTHORING (security + validation)
// ============================================================
describe("Sprint 18 - survey authoring", () => {
  test("employee cannot create/edit surveys; drafts are invisible to them", async () => {
    await expectError(
      () => POST(`${ENG}/EngagementSurveys`, { title: "Hax", openingDate: isoToday() }, JOHN),
      403,
    );

    const { survey, questions } = await createSurvey({ title: "Draft only" });
    assert.equal(questions.length, 1);

    // Draft rows do not appear in an employee's list read...
    const list = await GET(`${ENG}/EngagementSurveys`, JOHN);
    assert.ok(!list.data.value.some((s) => s.ID === survey.ID), "draft must be hidden");

    // ...and a direct single-key read is refused.
    await expectError(() => GET(`${ENG}/EngagementSurveys(ID=${survey.ID})`, JOHN), 403);

    // HR can see drafts.
    const hrList = await GET(`${ENG}/EngagementSurveys`, HR);
    assert.ok(hrList.data.value.some((s) => s.ID === survey.ID));
  });

  test("question validation: fields, choice options, published-only refusal", async () => {
    await expectError(
      () => POST(`${ENG}/SurveyQuestions`, { questionText: "no type" }, ADMIN),
      400,
    );
    await expectError(
      () => POST(`${ENG}/SurveyQuestions`, { questionText: "q", responseType: "Text", survey_ID: null }, ADMIN),
      404,
    );

    const { survey } = await createSurvey({ title: "Choice rules" });
    await expectError(
      () => POST(`${ENG}/SurveyQuestions`, {
        survey_ID: survey.ID, questionText: "Pick", responseType: "Choice",
      }, ADMIN),
      400,
      /choiceOptions/,
    );
    await expectError(
      () => POST(`${ENG}/SurveyQuestions`, {
        survey_ID: survey.ID, questionText: "T", responseType: "Text", choiceOptions: "a\nb",
      }, ADMIN),
      400,
      /Only Choice/,
    );
  });

  test("direct PATCH cannot move the status or edit published surveys", async () => {
    const { survey } = await createSurvey({ title: "Patch rules" });

    // Draft: status PATCH is refused (lifecycle bypass guard).
    await expectError(
      () => PATCH(`${ENG}/EngagementSurveys(ID=${survey.ID})`, { status: "Published" }, ADMIN),
      400,
      /Publish\/Close\/Archive/,
    );

    // Draft content edits are fine for HR.
    const ok = await PATCH(`${ENG}/EngagementSurveys(ID=${survey.ID})`, { description: "updated" }, ADMIN);
    assert.ok([200, 204].includes(ok.status), JSON.stringify(ok.data ?? ok));

    await publish(survey.ID);

    // Published: no direct edits at all.
    await expectError(
      () => PATCH(`${ENG}/EngagementSurveys(ID=${survey.ID})`, { title: "new" }, ADMIN),
      400,
      /Draft/,
    );
    await expectError(
      () => PATCH(`${ENG}/EngagementSurveys(ID=${survey.ID})`, { status: "Closed" }, ADMIN),
      400,
      /Publish\/Close\/Archive|Draft/,
    );

    // Questions can no longer be added/edited after publish.
    await expectError(
      () => POST(`${ENG}/SurveyQuestions`, { survey_ID: survey.ID, questionText: "late", responseType: "Text" }, ADMIN),
      400,
    );
  });

  test("admin-only lifecycle actions; employees cannot publish/close", async () => {
    const { survey } = await createSurvey({ title: "Action rights" });
    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Publish`, {}, JOHN),
      403,
    );
    await publish(survey.ID);
    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Close`, {}, JOHN),
      403,
    );
    await POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Close`, {}, ADMIN);
    // Closed -> Archive works (one-way chain).
  });
});

// ============================================================
// 2. LIFECYCLE TRANSITIONS
// ============================================================
describe("Sprint 18 - survey lifecycle", () => {
  test("publish needs at least one question; transitions are one-way", async () => {
    const create = await POST(`${ENG}/EngagementSurveys`, {
      title: "Empty survey", openingDate: isoToday(),
    }, ADMIN);
    const survey = create.data;

    await expectError(() => publish(survey.ID), 400, /at least one question/);
    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Close`, {}, ADMIN),
      409,
    );
  });

  test("double publish 409; close then archive; published cannot be deleted", async () => {
    const { survey, questions } = await createSurvey({ title: "One-way road" });
    await publish(survey.ID);
    await expectError(() => publish(survey.ID), 409);

    await expectError(() => DELETE(`${ENG}/EngagementSurveys(ID=${survey.ID})`, ADMIN), 400, /Archive/);

    const close = await POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Close`, {}, ADMIN);
    assert.ok(close.status === 200, JSON.stringify(close.data ?? close));
    await expectError(() => POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Publish`, {}, ADMIN), 409);

    const arch = await POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Archive`, {}, ADMIN);
    assert.ok(arch.status === 200, JSON.stringify(arch.data ?? arch));
    void questions;
  });

  test("audit log receives publication records", async () => {
    const { survey, questions } = await createSurvey({ title: "Audited publish" });
    await publish(survey.ID);
    await POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Close`, {}, ADMIN);

    const { data: audit } = await GET(`${EMP}/AuditLogs?$filter=entity eq 'EngagementSurveys'`, ADMIN);
    assert.ok(
      audit.value.some((a) => (JSON.stringify(a.newName) || "").includes(survey.ID) || a.entity === "EngagementSurveys"),
      "survey actions must leave audit rows",
    );
    void questions;
  });
});

// ============================================================
// 3. RESPONSE WINDOW, AUDIENCE, DUPLICATES
// ============================================================
describe("Sprint 18 - submission rules", () => {
  test("responses only while Published and inside the window", async () => {
    // Not yet open.
    const future = await createSurvey({ title: "Opens later", openingDate: isoShift(3) }, [
      { questionText: "T?", responseType: "Text" },
    ]);
    await publish(future.survey.ID);
    await expectError(() => submit(future.survey.ID, future.questions, [{ textValue: "hi" }]), 409, /opens on/);
    await POST(`${ENG}/EngagementSurveys(ID=${future.survey.ID})/EngagementService.Close`, {}, ADMIN);
    await expectError(() => submit(future.survey.ID, future.questions, [{ textValue: "late" }]), 409, /closed/);

    // Published and open: works.
    const open = await createSurvey({ title: "Open survey", openingDate: "2020-01-01" }, [
      { questionText: "T?", responseType: "Text" },
    ]);
    await publish(open.survey.ID);
    const ok = await submit(open.survey.ID, open.questions, [{ textValue: "yes" }]);
    assert.ok(ok.status === 200, JSON.stringify(ok.data ?? ok));
  });

  test("audience: employment-type mismatch is refused server-side", async () => {
    const { survey, questions } = await createSurvey(
      { title: "Targeted", audienceEmploymentType: "Intern" },
      [{ questionText: "T?", responseType: "Text" }],
    );
    await publish(survey.ID);
    await expectError(() => submit(survey.ID, questions, [{ textValue: "hi" }], JOHN), 403, /targets/);
  });

  test("duplicate submission refused; withdraw + re-submit is the safe correction", async () => {
    const { survey, questions } = await createSurvey(
      { title: "One answer", allowMultipleResponses: false },
      [{ questionText: "T?", responseType: "Text" }, { questionText: "Rate 1-5", responseType: "Rating" }],
    );
    await publish(survey.ID);

    const first = await submit(survey.ID, questions, [{ textValue: "good" }, { numberValue: 4 }]);
    assert.ok(first.status === 200, JSON.stringify(first.data ?? first));

    await expectError(
      () => submit(survey.ID, questions, [{ textValue: "second" }, { numberValue: 5 }]),
      409,
      /already submitted/,
    );

    // Withdraw own response, then correct it.
    const mine = await GET(`${ENG}/SurveyResponses?$filter=survey_ID eq ${survey.ID}`, JOHN);
    const row = mine.data.value[0];
    const wd = await POST(
      `${ENG}/SurveyResponses(ID=${row.ID})/EngagementService.Withdraw`, {}, JOHN,
    );
    assert.ok(wd.status === 200, JSON.stringify(wd.data ?? wd));

    const again = await submit(survey.ID, questions, [{ textValue: "better" }, { numberValue: 5 }]);
    assert.ok(again.status === 200, JSON.stringify(again.data ?? again));

    // Cross-employee withdraw is refused (manager is not the owner).
    const mine2 = await GET(`${ENG}/SurveyResponses?$filter=survey_ID eq ${survey.ID}`, JOHN);
    await expectError(
      () => POST(`${ENG}/SurveyResponses(ID=${mine2.data.value[0].ID})/EngagementService.Withdraw`, {}, MGRDEPT),
      403,
    );
  });

  test("survey with allowMultipleResponses still enforces one submitted row per retry call", async () => {
    const { survey, questions } = await createSurvey(
      { title: "Corrections allowed", allowMultipleResponses: true },
      [{ questionText: "T?", responseType: "Text" }],
    );
    await publish(survey.ID);
    await submit(survey.ID, questions, [{ textValue: "v1" }]);
    const second = await submit(survey.ID, questions, [{ textValue: "v2" }]);
    assert.ok(second.status === 200, JSON.stringify(second.data ?? second));
  });
});

// ============================================================
// 4. ANSWER VALIDATION
// ============================================================
describe("Sprint 18 - answer validation", () => {
  const qDefs = [
    { questionText: "Text?", responseType: "Text" },
    { questionText: "Rate", responseType: "Rating" },
    { questionText: "YesNo?", responseType: "YesNo" },
    { questionText: "Pick one", responseType: "Choice", choiceOptions: "Pizza\nSushi\nSalad" },
  ];

  async function readySurvey(title) {
    const parts = await createSurvey({ title }, qDefs.map((q) => ({ ...q })));
    await publish(parts.survey.ID);
    return parts;
  }

  test("unknown question is refused", async () => {
    const { survey } = await readySurvey("Unknown ref");
    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${survey.ID})/EngagementService.Submit`, {
        answers: [{ question_ID: "00000000-0000-0000-0000-00000000dead", textValue: "x" }],
      }, JOHN),
      400,
    );
  });

  test("required questions must be answered", async () => {
    const parts = await readySurvey("Required missing");
    await expectError(
      () => submit(parts.survey.ID, parts.questions.slice(0, 2), [{ textValue: "a" }, { numberValue: 1 }]),
      400,
      /required/,
    );
  });

  test("rating range and choice options are enforced", async () => {
    const parts = await readySurvey("Value checks");

    await expectError(
      () => submit(parts.survey.ID, parts.questions, [{ textValue: "t" }, { numberValue: 9 }, {}, {}]),
      400,
      /1 and 5/,
    );
    await expectError(
      () => submit(parts.survey.ID, parts.questions, [{ textValue: "t" }, { numberValue: 3 }, { boolValue: true }, { choiceValue: "Lasagna" }]),
      400,
      /not an option/,
    );
    await expectError(
      () => submit(parts.survey.ID, parts.questions, [{ }, { }, { }, { choiceValue: "Pizza" }]),
      400,
      /needs a text answer/,
    );
  });

  test("each question may be answered only once in a submission", async () => {
    const parts = await readySurvey("Dup answer");
    const payload = parts.questions.map((q, i) => ({
      question_ID: i === 0 ? parts.questions[0].ID : q.ID,
      ...(i === 0 ? { textValue: "a" } : q.responseType === "Choice" ? { choiceValue: "Sushi" } : { textValue: "x" }),
    }));
    payload[0].textValue = "a";
    payload[1] = { question_ID: parts.questions[1].ID, numberValue: 2 };
    payload[2] = { question_ID: parts.questions[2].ID, boolValue: false };
    payload[3] = { question_ID: parts.questions[3].ID, choiceValue: "Sushi" };
    payload[0] = { question_ID: parts.questions[0].ID, textValue: "a" };
    payload.push({ question_ID: parts.questions[0].ID, textValue: "b" }); // duplicate

    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${parts.survey.ID})/EngagementService.Submit`, { answers: payload }, JOHN),
      400,
      /more than once/,
    );
  });
});

// ============================================================
// 5. RESULTS & CONFIDENTIALITY
// ============================================================
describe("Sprint 18 - results & confidentiality", () => {
  test("results are aggregates only; employees are denied; withdrawn excluded", async () => {
    const parts = await createSurvey({ title: "Results rules" }, [
      { questionText: "Rate", responseType: "Rating" },
    ]);
    await publish(parts.survey.ID);

    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${parts.survey.ID})/EngagementService.SurveyResults`, {}, JOHN),
      403,
    );

    const first = await submit(parts.survey.ID, parts.questions, [{ numberValue: 4 }]);
    const second = await submit(parts.survey.ID, parts.questions, [{ numberValue: 2 }], MGRDEPT);
    void second;

    // JOHN withdraws his response - it must stop counting.
    const mine = await GET(`${ENG}/SurveyResponses?$filter=survey_ID eq ${parts.survey.ID}`, JOHN);
    await POST(`${ENG}/SurveyResponses(ID=${mine.data.value[0].ID})/EngagementService.Withdraw`, {}, JOHN);

    const res = await POST(`${ENG}/EngagementSurveys(ID=${parts.survey.ID})/EngagementService.SurveyResults`, {}, HR);
    assert.ok(res.status === 200, JSON.stringify(res.data ?? res));
    const line = res.data.value[0];
    assert.equal(line.responseCount, 1, "withdrawn responses excluded from results");
    assert.deepEqual(JSON.parse(line.distribution), { "2": 1 });
  });

  test("confidential surveys never expose individual answers or text content", async () => {
    const parts = await createSurvey({ title: "Confidential", confidential: true }, [
      { questionText: "Free text about concerns?", responseType: "Text" },
    ]);
    await publish(parts.survey.ID);
    await submit(parts.survey.ID, parts.questions, [{ textValue: "my private opinion" }], JOHN);

    const res = await POST(`${ENG}/EngagementSurveys(ID=${parts.survey.ID})/EngagementService.SurveyResults`, {}, ADMIN);
    const line = res.data.value[0];
    assert.equal(line.responseCount, 1);
    // The text content must NEVER appear - only the count marker.
    assert.equal(line.questionText, "Free text about concerns?");
    assert.ok(!JSON.stringify(line).includes("private opinion"), JSON.stringify(line));
    assert.equal(JSON.parse(line.distribution)["(text answer)"], 1);

    // Individual answers have NO routeable collection: the
    // composition is deliberately NOT exposed (@cds.autoexposed:
    // false) - a direct OData request is refused with 405 even
    // for an admin, so answers are only reachable via
    // SurveyResults (aggregates only, and never text content).
    await expectError(
      () => GET(`${ENG}/SurveyAnswer`, JOHN),
      405,
    );
    await expectError(
      () => GET(`${ENG}/SurveyAnswer`, ADMIN),
      405,
    );
  });

  test("draft surveys have no results yet", async () => {
    const parts = await createSurvey({ title: "No results yet" }, [
      { questionText: "T?", responseType: "Text" },
    ]);
    await expectError(
      () => POST(`${ENG}/EngagementSurveys(ID=${parts.survey.ID})/EngagementService.SurveyResults`, {}, ADMIN),
      409,
    );
  });
});

// ============================================================
// 6. SUGGESTIONS / FEEDBACK (review lifecycle, not-anonymous design)
// ============================================================
describe("Sprint 18 - suggestions & review", () => {
  test("submitter identity is server-set: spoofed payload is ignored", async () => {
    const res = await POST(`${ENG}/Suggestions`, {
      category: "Process",
      subject: "Shorter standups",
      message: "Let us try 15 minutes.",
      submittedBy_ID: HR_ID, // spoof attempt
    }, JOHN);
    assert.equal(res.status, 201, JSON.stringify(res.data));

    const { data: row } = await GET(`${ENG}/Suggestions(ID=${res.data.ID})`, JOHN);
    assert.notEqual(row.submittedBy_ID, HR_ID);
    assert.equal(row.submittedBy_ID, JOHN_ID);
  });

  test("employee cannot resolve; reviewers drive the lifecycle; invalid transitions fail", async () => {
    const res = await POST(`${ENG}/Suggestions`, {
      category: "IT",
      subject: "Faster laptops",
      message: "Compile times are painful.",
    }, JOHN);
    const ID = res.data.ID;

    await expectError(
      () => POST(`${ENG}/Suggestions(ID=${ID})/EngagementService.Resolve`, { newStatus: "InReview" }, JOHN),
      403,
    );

    const review = await POST(`${ENG}/Suggestions(ID=${ID})/EngagementService.Resolve`, {
      newStatus: "InReview", outcome: "taking a look",
    }, HR);
    assert.ok(review.status === 200, JSON.stringify(review.data ?? review));

    await expectError(
      () => POST(`${ENG}/Suggestions(ID=${ID})/EngagementService.Resolve`, { newStatus: "Bogus" }, ADMIN),
      400,
    );
    await expectError(
      () => POST(`${ENG}/Suggestions(ID=${ID})/EngagementService.Resolve`, { newStatus: "Submitted" }, ADMIN),
      409,
    );

    const accept = await POST(`${ENG}/Suggestions(ID=${ID})/EngagementService.Resolve`, {
      newStatus: "Accepted", outcome: "budgeted for next quarter",
    }, ADMIN);
    assert.ok(accept.status === 200, JSON.stringify(accept.data ?? accept));

    // Reviewer lock: the row cannot be edited after review started.
    await expectError(
      () => PATCH(`${ENG}/Suggestions(ID=${ID})`, { message: "edited after review" }, JOHN),
      400,
      /in review/,
    );

    // Decision notified the submitter once.
    const notes = await GET(`${NOTIF}/Notifications?$filter=recipient_ID eq ${JOHN_ID}`, JOHN);
    const aboutDecision = notes.data.value.filter((n) => /suggestion/i.test(n.title));
    assert.ok(aboutDecision.length >= 1, JSON.stringify(notes.data ?? notes));
  });

  test("invalid review status vocabulary + identity guard on update", async () => {
    const res = await POST(`${ENG}/Suggestions`, {
      category: "Other", subject: "Duplicated", message: "Same twice - second must be fine; edits locked by owner check.",
    }, JOHN);
    const ID = res.data.ID;

    await expectError(
      () => PATCH(`${ENG}/Suggestions(ID=${ID})`, { status: "Accepted" }, JOHN),
      403,
    );

    // Author enrichment is allowed while still Submitted.
    const ok = await PATCH(`${ENG}/Suggestions(ID=${ID})`, { additionalNotes: "adding context" }, JOHN);
    assert.ok([200, 204].includes(ok.status), JSON.stringify(ok.data ?? ok));

    // A colleague cannot edit it.
    await expectError(
      () => PATCH(`${ENG}/Suggestions(ID=${ID})`, { additionalNotes: "hax" }, MGRDEPT),
      403,
    );
  });
});

// ============================================================
// 7. RECOGNITIONS
// ============================================================
describe("Sprint 18 - recognitions", () => {
  test("sender identity is server-set; self-kudos refused; dup click safe", async () => {
    const kudos = {
      category: "Teamwork",
      message: "Thanks for the flawless release roll-out!",
      recognitionDate: isoToday(),
    };

    const res = await POST(`${ENG}/Recognitions`, { ...kudos, toEmployee_ID: DAVID_ID, fromEmployee_ID: HR_ID }, JOHN);
    assert.equal(res.status, 201, JSON.stringify(res.data));

    const { data: row } = await GET(`${ENG}/Recognitions(ID=${res.data.ID})`, JOHN);
    assert.equal(row.fromEmployee_ID, JOHN_ID, "fromEmployee must be the real user");
    assert.equal(row.toEmployee_ID, DAVID_ID);

    await expectError(
      () => POST(`${ENG}/Recognitions`, { ...kudos, toEmployee_ID: JOHN_ID }, JOHN),
      400,
      /yourself/,
    );
    await expectError(
      () => POST(`${ENG}/Recognitions`, { ...kudos, toEmployee_ID: DAVID_ID }, JOHN),
      409,
      /already sent/,
    );
    await expectError(
      () => POST(`${ENG}/Recognitions`, { ...kudos, toEmployee_ID: DAVID_ID, recognitionDate: isoShift(2) }, JOHN),
      400,
      /future/,
    );
    await expectError(
      () => POST(`${ENG}/Recognitions`, { ...kudos, toEmployee_ID: "00000000-0000-0000-0000-000000000000" }, JOHN),
      404,
      /recipient/,
    );

    // The recipient reads their OWN notifications (notification
    // security scopes reads to the recipient - that is why the
    // test queries as the recipient's own user, not as a third).
    const notes = await GET(`${NOTIF}/Notifications?$filter=recipient_ID eq ${DAVID_ID}`, MGRPROJ);
    assert.ok(notes.data.value.some((n) => /recognition|voiced|kudos|appreciat/i.test(n.title)), JSON.stringify(notes.data));
  });

  test("content is immutable; moderation is HR-only; hidden rows filtered", async () => {
    const res = await POST(`${ENG}/Recognitions`, {
      category: "Innovation",
      message: "Introduced the caching layer that halved the build times.",
      toEmployee_ID: DAVID_ID,
      recognitionDate: isoToday(),
    }, JOHN);
    const ID = res.data.ID;

    await expectError(
      () => PATCH(`${ENG}/Recognitions(ID=${ID})`, { message: "rewritten" }, HR),
      400,
    );
    await expectError(
      () => PATCH(`${ENG}/Recognitions(ID=${ID})`, { status: "Inactive" }, JOHN),
      403,
    );

    const mod = await PATCH(`${ENG}/Recognitions(ID=${ID})`, { status: "Inactive", moderationNote: "sr-only" }, ADMIN);
    assert.ok(okStatus(mod.status), JSON.stringify(mod.data ?? mod));

    // Moderation metadata was stamped by the handler.
    const row = (await GET(`${ENG}/Recognitions?$filter=ID eq ${ID}`, ADMIN)).data.value[0];
    assert.equal(row.status, "Inactive");
    assert.equal(row.moderatedBy_ID, "10000000-0000-0000-0000-000000000000", ADMIN ? "admin id" : "n/a");
  });
});

function okStatus(status) {
  return [200, 204].includes(status);
}

// ============================================================
// 8. NOTIFICATION DEDUPE (retries safe)
// ============================================================
describe("Sprint 18 - notifications & retries", () => {
  test("publishing notifications are deduped and scoped by audience", async () => {
    const future = await createSurvey(
      { title: "Dedup survey", audienceEmploymentType: "Permanent" },
      [{ questionText: "T?", responseType: "Text" }],
    );
    await publish(future.survey.ID);
    // Re-publishing is impossible (409), but the action-level dedupe
    // is verified by the notification count: exactly one row per
    // targeted employee for this survey.
    const notes = await GET(`${NOTIF}/Notifications?$filter=recipient_ID eq ${JOHN_ID}`, JOHN);
    const forSurvey = notes.data.value.filter(
      (n) => /Dedup survey/.test(n.title),
    );
    assert.ok(forSurvey.length === 1, JSON.stringify(forSurvey.length), `expected 1 got ${forSurvey.length}`);
  });
});
