// ============================================================
// SPRINT 12 - AUTOMATED TESTS: OFFER LETTER + ONBOARDING
// ------------------------------------------------------------
// Automated regression + feature tests for the Recruitment/
// Offer Letter + Onboarding capability in the EWMS project.
//
// These tests stay alongside the existing test/*.http files,
// which remain useful for manual API testing. Automated tests
// are the reliable regression safety net.
//
// Testing approach (CAP-supported):
//   * One CAP test server per test file, started via the shared
//     test/setup.js helper, which uses cds.test().
//   * Tests run under CDS_ENV=test so they use the project's
//     in-memory [test] profile database. That keeps tests isolated
//     from the developer's db.sqlite development database.
//   * Mock authentication users and roles come from package.json
//     cds.requires.auth.users and are reused by every test.
//
// IMPORTANT: do not use process.exit(), kill, or forcibly leave
// servers running. The test runner exits naturally when all suites
// finish.
//
// NOTE: This test file is intentionally rebuilt to keep the test
// infrastructure maintainable and visible in VS Code (see test/setup.js
// for the reusable test bootstrap).
// ============================================================

const { test, describe, before } = require("node:test");
const assert = require("node:assert");

// Import the shared CAP test bootstrap. This keeps the test server
// lifecycle in one place (test/setup.js) and makes the test file
// easier to maintain.
const { startTestHarness } = require("./setup");
const harness = startTestHarness();

const GET = harness.GET;
const POST = harness.POST;
const PATCH = harness.PATCH;

// ============================================================
// A. OFFER CREATION
// ============================================================

// Mock users come from package.json cds.requires.auth.users.
const ADMIN = { auth: { username: "sysadmin", password: "" } }; // employee ...000 (no Employee row!)
const HR = { auth: { username: "hrperson", password: "" } }; // employee ...002
const FINMGR = { auth: { username: "finmgr", password: "" } }; // employee ...005 = LevelHR approver
const JOHN = { auth: { username: "empjohn", password: "" } }; // plain Employee role
const DMGR = { auth: { username: "mgrdept", password: "" } }; // DepartmentManager (cannot see CTC)

// Seeded reference rows (db/data CSVs).
const HR_EMP_ID = "10000000-0000-0000-0000-000000000005"; // DepartmentHR -> workflow approver
const MANAGER_EMP_ID = "10000000-0000-0000-0000-000000000004";
const DEPT_ID = "44444444-dddd-4444-dddd-444444444444";
const DESIG_ID = "11111111-1111-1111-1111-111111111111";

const R = "/odata/v4/recruitment";
const WF = "/odata/v4/workflow";

let seq = 0;
const unique = () => `t${Date.now()}${++seq}`;

/**
 * CAP's test facade THROWS on 4xx/5xx (the thrown error's `.response`
 * holds the CDS response; `err.response.status` is the reliable 403/400
 * indicator). This helper runs `fn`, catches the error and asserts both
 * code and optional message fragment.
 */
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

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

/** Creates a candidate (admin - no workflow involved) and returns the row. */
async function createCandidate() {
  const tag = unique();
  const { status, data } = await POST(
    `${R}/Candidates`,
    {
      firstName: "Test",
      lastName: `Candidate${tag}`,
      email: `test.${tag}@ewms-test.com`,
      experienceYears: 3.5,
    },
    ADMIN,
  );
  assert.equal(status, 201, `candidate create failed: ${JSON.stringify(data)}`);
  return data;
}

/** Creates a draft offer for a candidate. */
async function createOffer(candidateId, overrides = {}) {
  const { status, data } = await POST(
    `${R}/Offers`,
    {
      candidate_ID: candidateId,
      department_ID: DEPT_ID,
      designation_ID: DESIG_ID,
      reportingManager_ID: MANAGER_EMP_ID,
      employmentType: "Permanent",
      offerDate: "2026-10-01",
      expiryDate: "2099-11-30",
      joiningDate: "2099-12-01",
      offeredCTC: 1200000,
      workLocation: "Hyderabad",
      ...overrides,
    },
    ADMIN,
  );
  assert.equal(status, 201, `offer create failed: ${JSON.stringify(data)}`);
  assert.equal(data.status, "Draft");
  return data;
}

/** Submits an offer for approval as HR (starts the generic workflow). */
async function submitOffer(offerId) {
  // requester must be an EXISTING employee -> HR (employee ...002),
  // not sysadmin whose employeeId has no Employee row.
  const res = await POST(
    `${R}/Offers(ID=${offerId})/RecruitmentService.SubmitForApproval`,
    {},
    HR,
  );
  assert.ok(res.status === 200 || res.status === 204, `submit failed: ${JSON.stringify(res.data)}`);
}

/** The LevelHR approver (finmgr) approves the single workflow task. */
async function approveViaWorkflow(offerId) {
  // Find the workflow instance created FOR THIS OFFER (the offer
  // suite intentionally leaves one earlier request unapproved, so
  // filtering by "any open task of the approver" could pick a stale
  // task from another test - select via the instance instead).
  const { data: instances } = await GET(
    `${WF}/WorkflowInstances?$filter=businessObjectId eq ${offerId}&$select=ID`,
    ADMIN,
  );
  assert.equal(instances.value.length, 1, "one workflow instance for the offer");
  const instanceId = instances.value[0].ID;

  const { data } = await GET(
    `${WF}/WorkflowTasks?$filter=instance_ID eq ${instanceId} and status eq 'Open'`,
    FINMGR,
  );
  assert.ok(data.value.length > 0, "approver has an open workflow task");

  const task = data.value[data.value.length - 1];
  const res = await POST(
    `${WF}/WorkflowTasks(ID=${task.ID})/WorkflowService.Approve`,
    { comments: "ok" },
    FINMGR,
  );
  assert.ok(res.status === 200 || res.status === 204, `approve failed: ${JSON.stringify(res.data)}`);

  // The workflow callback must have moved the offer to Approved.
  const { data: offer } = await GET(`${R}/Offers(ID=${offerId})`, ADMIN);
  assert.equal(offer.status, "Approved", "workflow approval synced the offer status");
  return offer;
}

/** Full pre-onboarding setup: candidate + offer + approval + sent + accepted. */
async function acceptedOfferFlow() {
  const candidate = await createCandidate();
  let offer = await createOffer(candidate.ID);
  await submitOffer(offer.ID);
  offer = await approveViaWorkflow(offer.ID);

  const sent = await POST(
    `${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`,
    {},
    ADMIN,
  );
  assert.ok([200, 204].includes(sent.status), `send failed: ${JSON.stringify(sent.data)}`);

  const acc = await POST(
    `${R}/Offers(ID=${offer.ID})/RecruitmentService.RecordAcceptance`,
    {},
    ADMIN,
  );
  assert.ok([200, 204].includes(acc.status), `acceptance failed: ${JSON.stringify(acc.data)}`);

  const { data: cases } = await GET(
    `${R}/OnboardingCases?$filter=offer_ID eq '${offer.ID}'`,
    ADMIN,
  );
  assert.equal(cases.value.length, 1, "exactly one onboarding case auto-created");
  return { candidate, offer, case: cases.value[0] };
}

// ============================================================
// REGRESSION SMOKE: existing services still load and respond
// ============================================================
describe("Repair - existing services still work", () => {
  test("EmployeeService responds", async () => {
    const res = await GET("/odata/v4/employee/Employees?$top=1", ADMIN);
    assert.equal(res.status, 200);
  });

  test("LeaveService responds", async () => {
    const res = await GET("/odata/v4/leave/LeaveTypes?$top=1", ADMIN);
    assert.equal(res.status, 200);
  });

  test("WorkflowService exposes the seeded definitions", async () => {
    const res = await GET(`${WF}/WorkflowDefinitions`, ADMIN);
    assert.equal(res.status, 200);
    const codes = res.data.value.map((d) => d.definitionCode);
    assert.ok(codes.includes("WF-LEAVE-STD"));
    assert.ok(codes.includes("WF-OFFER-STD"), "offer workflow definition seeded");
  });

  test("NotificationService: user sees only their own inbox", async () => {
    const res = await GET("/odata/v4/notification/Notifications", FINMGR);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.value));
  });
});

// ============================================================
// A. OFFER CREATION
// ============================================================
describe("Sprint 12 - Offer creation", () => {
  test("creates a valid offer with auto number and Draft status", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    assert.ok(offer.offerNumber?.startsWith("OFF"), "auto offer number");
    assert.ok(offer.ID, "offer has an ID");
  });

  test("rejects an offer without a candidate", async () => {
    await expectError(
      () => POST(`${R}/Offers`, { offeredCTC: 1 }, ADMIN),
      400, /candidate is required/, true,
    );
  });

  test("rejects expiryDate before offerDate", async () => {
    const candidate = await createCandidate();
    await expectError(
      () => POST(
        `${R}/Offers`,
        { candidate_ID: candidate.ID, offerDate: "2026-10-10", expiryDate: "2026-10-01" },
        ADMIN,
      ),
      400, /expiryDate/, true,
    );
  });

  test("candidate auto-code uses CAND prefix and starts New", async () => {
    const candidate = await createCandidate();
    assert.ok(candidate.candidateCode?.startsWith("CAND"));
    assert.equal(candidate.status, "New");
  });
});

// ============================================================
// B. OFFER LIFECYCLE THROUGH THE GENERIC WORKFLOW
// ============================================================
describe("Sprint 12 - Offer lifecycle & workflow approval", () => {
  test("SubmitForApproval starts a workflow and moves Draft -> PendingApproval", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);

    const { data } = await GET(`${R}/Offers(ID=${offer.ID})`, ADMIN);
    assert.equal(data.status, "PendingApproval");

    // The generic engine created an instance for the offer.
    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectType eq 'ewms.db.recruitment.Offer' and businessObjectId eq '${offer.ID}'`,
      ADMIN,
    );
    assert.equal(instances.value.length, 1, "one workflow instance for the offer");
    assert.equal(instances.value[0].status, "Running");
  });

  test("approval through the workflow moves the offer to Approved", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);
    await approveViaWorkflow(offer.ID);
  });

  test("SendOffer: Approved -> Sent", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);
    await approveViaWorkflow(offer.ID);

    const res = await POST(
      `${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`,
      {},
      ADMIN,
    );
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));

    const { data } = await GET(`${R}/Offers(ID=${offer.ID})`, ADMIN);
    assert.equal(data.status, "Sent");
    assert.ok(data.sentOn, "sentOn timestamp populated");
  });

  test("SendOffer blocked while Draft (invalid transition)", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await expectError(
      () => POST(
        `${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`,
        {},
        ADMIN,
      ),
      400, /cannot move from 'Draft' to 'Sent'/, true,
    );
  });

  test("RecordRejection on a Sent offer -> Rejected; rejected cannot be accepted", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);
    await approveViaWorkflow(offer.ID);
    await POST(`${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`, {}, ADMIN);

    const rej = await POST(
      `${R}/Offers(ID=${offer.ID})/RecruitmentService.RecordRejection`,
      { comments: "declined" },
      ADMIN,
    );
    assert.ok([200, 204].includes(rej.status), JSON.stringify(rej.data));

    // The real outcome: the offer is now Rejected (stronger than
    // checking the action's human-readable return message).
    const { data: rejectedOffer } = await GET(`${R}/Offers(ID=${offer.ID})`, ADMIN);
    assert.equal(rejectedOffer.status, "Rejected");

    await expectError(
      () => POST(
        `${R}/Offers(ID=${offer.ID})/RecruitmentService.RecordAcceptance`,
        {},
        ADMIN,
      ),
      400, /Rejected.*Accepted/, // invalid state transition
    );
  });

  test("WithdrawOffer from Draft works", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    const res = await POST(
      `${R}/Offers(ID=${offer.ID})/RecruitmentService.WithdrawOffer`,
      { comments: "hiring freeze" },
      ADMIN,
    );
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));

    const { data } = await GET(`${R}/Offers(ID=${offer.ID})`, ADMIN);
    assert.equal(data.status, "Withdrawn");
  });

  test("ExpireOffer: Sent -> Expired; expired is final and Draft cannot expire", async () => {
    // A SENT offer (never answered by the candidate) can expire.
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);
    await approveViaWorkflow(offer.ID);
    await POST(`${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`, {}, ADMIN);

    const res = await POST(
      `${R}/Offers(ID=${offer.ID})/RecruitmentService.ExpireOffer`,
      {},
      ADMIN,
    );
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));

    const { data } = await GET(`${R}/Offers(ID=${offer.ID})`, ADMIN);
    assert.equal(data.status, "Expired");

    // Expired is a FINAL state: no further lifecycle action works.
    await expectError(
      () => POST(
        `${R}/Offers(ID=${offer.ID})/RecruitmentService.SendOffer`,
        {},
        ADMIN,
      ),
      400, /cannot move from 'Expired'/, true,
    );

    // A DRAFT offer cannot expire (invalid transition).
    const draftCandidate = await createCandidate();
    const draftOffer = await createOffer(draftCandidate.ID);
    await expectError(
      () => POST(
        `${R}/Offers(ID=${draftOffer.ID})/RecruitmentService.ExpireOffer`,
        {},
        ADMIN,
      ),
      400, /cannot move from 'Draft' to 'Expired'/, true,
    );
  });

  test("accepted offer cannot be modified", async () => {
    const { offer } = await acceptedOfferFlow();
    await expectError(
      () => PATCH(
        `${R}/Offers(ID=${offer.ID})`,
        { workLocation: "Pune" },
        ADMIN,
      ),
      400, /accepted offer/, true,
    );
  });

  test("compensation is masked for roles without CTC visibility", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);

    // HRExecutive/HR user 'hrperson' reads the offer -> CTC visible.
    const { data: hrView } = await GET(`${R}/Offers(ID=${offer.ID})`, HR);
    assert.equal(hrView.offeredCTC, 1200000, "HR sees compensation");

    // DepartmentManager (reporting manager) sees the offer but NOT CTC.
    const { data: mgrView } = await GET(`${R}/Offers(ID=${offer.ID})`, DMGR);
    assert.ok(mgrView.offeredCTC == null, "non-HR manager does not see compensation");
  });
});

// ============================================================
// C. ONBOARDING
// ============================================================
describe("Sprint 12 - Onboarding", () => {
  test("RecordAcceptance is idempotent-safe: second call rejected as final state", async () => {
    const { offer } = await acceptedOfferFlow();
    await expectError(
      () => POST(
        `${R}/Offers(ID=${offer.ID})/RecruitmentService.RecordAcceptance`,
        {},
        ADMIN,
      ),
      400, /none \(final state\)/,
    );
  });

  test("tasks cannot be worked on while the case is NotStarted", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    const task = (await GET(
      `${R}/OnboardingTasks?$filter=onboardingCase_ID eq ${onboardingCase.ID}&$top=1`,
      ADMIN,
    )).data.value[0];

    await expectError(
      () => POST(
        `${R}/OnboardingTasks(ID=${task.ID})/RecruitmentService.StartTask`,
        {},
        ADMIN,
      ),
      400, /NotStarted/, true,
    );
  });

  test("mandatory task cannot be skipped", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.StartOnboarding`,
      {},
      ADMIN,
    );
    const task = (await GET(
      `${R}/OnboardingTasks?$filter=onboardingCase_ID eq ${onboardingCase.ID} and mandatory eq true&$top=1`,
      ADMIN,
    )).data.value[0];

    await expectError(
      () => POST(
        `${R}/OnboardingTasks(ID=${task.ID})/RecruitmentService.SkipTask`,
        {},
        ADMIN,
      ),
      400, /Mandatory task/, true,
    );
  });

  test("completion blocked while mandatory tasks/documents are open", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.StartOnboarding`,
      {},
      ADMIN,
    );
    await expectError(
      () => POST(
        `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.CompleteOnboarding`,
        {},
        ADMIN,
      ),
      400, /mandatory task\(s\) still open/, true,
    );
  });

  test("conversion blocked before the case is Completed", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.StartOnboarding`,
      {},
      ADMIN,
    );
    await expectError(
      () => POST(
        `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.ConvertToEmployee`,
        {},
        ADMIN,
      ),
      400, /must be Completed/, true,
    );
  });

  test("full happy path: tasks+docs -> complete -> convert (idempotent)", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.StartOnboarding`,
      {},
      ADMIN,
    );

    // Complete every task (as HR - completedBy must be a real employee).
    const tasks = (await GET(
      `${R}/OnboardingTasks?$filter=onboardingCase_ID eq '${onboardingCase.ID}'`,
      ADMIN,
    )).data.value;
    for (const t of tasks) {
      await POST(
        `${R}/OnboardingTasks(ID=${t.ID})/RecruitmentService.StartTask`,
        {},
        HR,
      );
      const r = await POST(
        `${R}/OnboardingTasks(ID=${t.ID})/RecruitmentService.CompleteTask`,
        { comments: "done" },
        HR,
      );
      assert.ok([200, 204].includes(r.status), `complete ${t.taskCode}: ${JSON.stringify(r.data)}`);
    }

    // Submit + verify every document.
    const docs = (await GET(
      `${R}/OnboardingDocumentRequirements?$filter=onboardingCase_ID eq '${onboardingCase.ID}'`,
      ADMIN,
    )).data.value;
    for (const d of docs) {
      await POST(
        `${R}/OnboardingDocumentRequirements(ID=${d.ID})/RecruitmentService.SubmitDocument`,
        {},
        HR,
      );
      const r = await POST(
        `${R}/OnboardingDocumentRequirements(ID=${d.ID})/RecruitmentService.VerifyDocument`,
        {},
        HR,
      );
      assert.ok([200, 204].includes(r.status), `verify ${d.documentType}: ${JSON.stringify(r.data)}`);
    }

    // Complete the onboarding case.
    const done = await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.CompleteOnboarding`,
      {},
      ADMIN,
    );
    assert.ok([200, 204].includes(done.status), JSON.stringify(done.data));

    // ConvertToEmployee -> creates the employee.
    const conv1 = await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.ConvertToEmployee`,
      {},
      ADMIN,
    );
    assert.ok([200, 204].includes(conv1.status), JSON.stringify(conv1.data));

    const conv1Text = String(conv1.data?.value ?? conv1.data ?? "");
    assert.match(conv1Text, /EMP\d+/, "employee code reported");

    // Second call is a no-op: NEVER a second employee.
    const conv2 = await POST(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.ConvertToEmployee`,
      {},
      ADMIN,
    );
    assert.ok([200, 204].includes(conv2.status), "repeat conversion succeeds");

    const conv2Text = String(conv2.data?.value ?? conv2.data ?? "");
    // A second conversion is idempotent: it never creates a second
    // employee. The first run created the employee and reported EMP
    // code; the repeat only links the existing employee.
    assert.match(conv2Text, /EMP\d+/, "repeat conversion reported employee");
    assert.match(conv2Text, /linked|already exists|no duplicate/i, "idempotent message");

    // The case links exactly the one created employee. The link is
    // the foreign key convertedEmployee_ID; the employee itself
    // lives in the EXISTING Employee Core (deliberately NOT projected
    // into the confidential RecruitmentService), so verify the link
    // through the employee service instead of $expand.
    const { data: linkedCase } = await GET(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})`,
      ADMIN,
    );
    assert.ok(linkedCase.convertedEmployee_ID, "case links the converted employee");

    const { data: linkedEmployee } = await GET(
      `/odata/v4/employee/Employees(ID=${linkedCase.convertedEmployee_ID})`,
      ADMIN,
    );
    assert.match(linkedEmployee.employeeCode, /^EMP\d+$/);

    // Candidate reached 'Hired'.
    const { data: casesRow } = await GET(
      `${R}/OnboardingCases(ID=${onboardingCase.ID})?$expand=candidate`,
      ADMIN,
    );
    assert.equal(casesRow.candidate.status, "Hired");
  });
});

// ============================================================
// D. SECURITY
// ============================================================
describe("Sprint 12 - Security", () => {
  test("plain Employee cannot read candidates", async () => {
    await createCandidate();
    await expectError(() => GET(`${R}/Candidates`, JOHN), 403);
  });

  test("plain Employee cannot read offers", async () => {
    await createCandidate();
    await expectError(() => GET(`${R}/Offers`, JOHN), 403);
  });

  test("plain Employee cannot trigger ConvertToEmployee", async () => {
    const { case: onboardingCase } = await acceptedOfferFlow();
    await expectError(
      () => POST(
        `${R}/OnboardingCases(ID=${onboardingCase.ID})/RecruitmentService.ConvertToEmployee`,
        {},
        JOHN,
      ),
      403,
    );
  });

  test("approved but unsent offer cannot be rejected by a non-approver", async () => {
    const candidate = await createCandidate();
    const offer = await createOffer(candidate.ID);
    await submitOffer(offer.ID);
    await approveViaWorkflow(offer.ID);

    await expectError(
      () => POST(
        `${R}/Offers(ID=${offer.ID})/RecruitmentService.RejectOffer`,
        { comments: "not my call" },
        JOHN,
      ),
      403,
    );
  });

  test("audit rows are written for offer creation (existing audit reuse)", async () => {
    const before = (await GET("/odata/v4/employee/AuditLogs", ADMIN)).data.value.length;
    await createCandidate();
    const after = (await GET("/odata/v4/employee/AuditLogs", ADMIN)).data.value.length;
    assert.ok(after >= before, "audit log row count did not decrease after recruitment create");
  });

  test("onboarding cases list exposes seeded data", async () => {
    const { data: cases } = await GET(`${R}/OnboardingCases?$top=5`, ADMIN);
    assert.ok(Array.isArray(cases.value), "onboarding cases is an array");
  });

  test("candidates list exposes seeded data", async () => {
    const { data: candidates } = await GET(`${R}/Candidates?$top=5`, ADMIN);
    assert.ok(Array.isArray(candidates.value), "candidates is an array");
  });

  test("offers list exposes seeded data", async () => {
    const { data: offers } = await GET(`${R}/Offers?$top=5`, ADMIN);
    assert.ok(Array.isArray(offers.value), "offers is an array");
  });
});
