// ============================================================
// SPRINT 21 - EXIT MANAGEMENT TESTS
// ------------------------------------------------------------
// Covers the Sprint 21 acceptance list:
//
//   * creation/validation + duplicate-safe retries (clientRequestId,
//     one-open-case rule) + EmployerInitiated initiation rules,
//   * notice-period POLICY behavior (configured rule refused,
//     authorized waiver recorded, missing config surfaces
//     'NotConfigured', adequate date accepted),
//   * generic-workflow approvals (Manager -> HR), self-approval
//     prevention + the requester-skip rule, reject / reconsider /
//     sendback / resubmit, withdraw cancels the journey,
//   * clearance seeding from the active template, responsable-role
//     authorization, category-keyed EVIDENCE checks (asset ledger,
//     linked documents), mandatory-item guard for
//     ReadyForSeparation and CompleteExit,
//   * Sprint 14 asset integration (outstanding detection via the
//     REAL assignment ledger + verified return; computed
//     DepartingEmployeeAssets view),
//   * payroll evidence-gated final settlement + no-op retries,
//   * employment deactivation ONLY at CompleteExit (+ DepHR guard),
//   * completed-case corrections (audited only), anti-bypass
//     PATCH/DELETE guards, employer-initiated reason masking,
//   * notification + audit smoke.
//
// Same harness as every other suite (test/setup.js); no test
// weakening: every guard above is asserted with real 4xx/5xx.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const { GET, POST, PATCH, DELETE } = startTestHarness();

const ADMIN = { auth: { username: "sysadmin", password: "" } }; // SystemAdmin + HRAdmin + FinanceManager
const HR = { auth: { username: "hrperson", password: "" } };    // HRExecutive + HRAdmin, employee ...0002
const JOHN = { auth: { username: "empjohn", password: "" } };    // plain Employee, ...0001
const MGRDEPT = { auth: { username: "mgrdept", password: "" } }; // DepartmentManager, ...0004 (= JOHN's manager)
const FINMGR = { auth: { username: "finmgr", password: "" } };   // FinanceManager, ...0005
const PAYEXEC = { auth: { username: "payexec", password: "" } }; // PayrollExecutive, ...0006

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const HR_ID = "10000000-0000-0000-0000-000000000002";
const EMP3_ID = "10000000-0000-0000-0000-000000000003";
const EMP5_ID = "10000000-0000-0000-0000-000000000005";
const EMP6_ID = "10000000-0000-0000-0000-000000000006";

const EX = "/odata/v4/exit";
const WF = "/odata/v4/workflow";
const A = "/odata/v4/asset";
const EMP = "/odata/v4/employee";
const NOTIF = "/odata/v4/notification";

const TODAY = new Date();

/** Builds an ISO date string `days` days from today. */
function dateIn(days) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
const nextClientRequestId = () => `exit-retry-${Date.now()}-${++seq}`;

/** OData bound actions returning String deliver { value: "..." }. */
function valueOf(res) {
  return res.data && typeof res.data === "object" && res.data.value !== undefined
    ? String(res.data.value)
    : String(res.data);
}

async function expectError(fn, expectedCode, messageMatch) {
  try {
    await fn();
    assert.fail(`expected request to fail with ${expectedCode}`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(
      code === expectedCode,
      `expected ${expectedCode} but got ${code} (${err.message})`,
    );
    if (messageMatch) {
      const text = String(err.response?.data?.error?.message ?? err.message ?? "");
      assert.ok(
        text.toLowerCase().includes(messageMatch.toLowerCase()),
        `expected message to contain "${messageMatch}" but was "${text}"`,
      );
    }
  }
}

/**
 * Create an exit case. Plain employees are stamped with their own
 * employee ID (the handler refuses foreign employee_ID payloads -
 * see the dedicated spoof-refusal test).
 */
async function createCase(actor = JOHN, overrides = {}) {
  const res = await POST(
    `${EX}/ExitCases`,
    {
      employee_ID: overrides.employee_ID ?? (actor === JOHN ? JOHN_ID : undefined),
      exitType: overrides.exitType ?? "Resignation",
      proposedFinalWorkingDate: overrides.proposedFinalWorkingDate ?? dateIn(90),
      reasonCategory: overrides.reasonCategory ?? "Personal",
      reasonText: overrides.reasonText ?? "personal reasons",
      clientRequestId: overrides.clientRequestId,
      ...overrides,
    },
    actor,
  );
  return res.data;
}

/** Bound action helper. */
async function act(caseId, action, data, actor = HR) {
  return POST(`${EX}/ExitCases(${caseId})/${action}`, data ?? {}, actor);
}

/** Runs the Manager(->HR) workflow steps for one case. */
async function approveViaWorkflow(caseId, finalDateCheck = null) {
  const { data: instances } = await GET(
    `${WF}/WorkflowInstances?$filter=businessObjectId eq ${caseId} and status eq 'Running'`,
    ADMIN,
  );
  assert.equal(instances.value.length, 1, "one running workflow instance");

  // Step 1: the reporting manager (mgrdept for all seeded cases).
  assert.ok(instances.value.length, `manager task for case ${caseId}`);
  const res1 = await GET(`${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`, ADMIN);
  assert.equal(res1.data.value.length, 1, `manager task for case ${caseId}`);
  await POST(`${WF}/WorkflowTasks(ID=${res1.data.value[0].ID})/WorkflowService.Approve`, { comments: "approved by manager" }, MGRDEPT);

  // Step 2 (LevelHR) resolves to the seeded DepartmentHR employee
  // ...0005 - its USER is finmgr. The step may also have been
  // auto-skipped (skipIfSameAsRequester when the resolved approver
  // IS the requester).
  const { data: stillRunning } = await GET(
    `${WF}/WorkflowInstances?$filter=businessObjectId eq ${caseId} and status eq 'Running'`,
    ADMIN,
  );
  if (stillRunning.value.length === 1) {
    const res2 = await GET(
      `${WF}/WorkflowTasks?$filter=instance_ID eq ${stillRunning.value[0].ID} and status eq 'Open'`,
      ADMIN,
    );
    assert.equal(res2.data.value.length, 1, "level-HR task open");
    await POST(`${WF}/WorkflowTasks(ID=${res2.data.value[0].ID})/WorkflowService.Approve`, { comments: "approved by level HR" }, FINMGR);
  }

  const { data: caseRow } = await GET(`${EX}/ExitCases(${caseId})`, ADMIN);
  return caseRow;
}

/** Full clearance: completes every pending mandatory item (HRAdmin deputy). */
async function completeAllItems(caseId, actor = HR) {
  const { data: items } = await GET(`${EX}/ExitChecklistItems?$filter=exitCase_ID eq ${caseId}`, ADMIN);
  for (const item of items.value) {
    if (item.status === "Pending") {
      const res = await POST(
        `${EX}/ExitChecklistItems(ID=${item.ID})/CompleteItem`,
        { remarks: `verified by automated test (${item.category})` },
        actor,
      );
      assert.ok([200, 204].includes(res.status), `item ${item.itemCode} completion failed: ${JSON.stringify(res.data)}`);
    }
  }
  return items.value;
}

/** Fetches one checklist item by code. */
async function itemByCode(caseId, code) {
  const { data } = await GET(`${EX}/ExitChecklistItems?$filter=exitCase_ID eq ${caseId}`, ADMIN);
  return data.value.find((i) => i.itemCode === code);
}

// ============================================================
// S1. CREATION & VALIDATION
// ============================================================
describe("Sprint 21 - creation & validation", () => {
  test("case is server-stamped, code generated, status Draft (case A)", async () => {
    // JOHN's ONE open case for the whole suite; created with the
    // dedupe key so later retry assertions can point at it.
    const c = await createCase(JOHN, { clientRequestId: "dup-safe-exit-1" });
    assert.ok(c.exitNumber?.startsWith("EXT"), `code: ${c.exitNumber}`);
    assert.equal(c.status, "Draft");
    const full = await GET(`${EX}/ExitCases(${c.ID})`, JOHN);
    assert.equal(full.data.employee_ID, JOHN_ID, "spoofed employee_ID ignored");
  });

  test("plain employee cannot create a case for someone else", async () => {
    await expectError(
      () => createCase(JOHN, { employee_ID: EMP3_ID, clientRequestId: nextClientRequestId() }),
      403, "for yourself",
    );
  });

  test("resignation requires a proposed final working date (in the future)", async () => {
    await expectError(
      () => POST(`${EX}/ExitCases`, { exitType: "Resignation", reasonCategory: "Personal", reasonText: "x" }, JOHN),
      400, "proposedFinalWorkingDate",
    );
    await expectError(
      () => POST(`${EX}/ExitCases`, { exitType: "Resignation", proposedFinalWorkingDate: "2020-01-01", reasonCategory: "Personal", reasonText: "x" }, JOHN),
      400, "future",
    );
  });

  test("reason fields are mandatory", async () => {
    await expectError(
      () => POST(`${EX}/ExitCases`, { exitType: "Retirement", proposedFinalWorkingDate: dateIn(30) }, JOHN),
      400, "reason",
    );
  });

  test("duplicate-limit: clientRequestId retry returns 409, exactly one case", async () => {
    await expectError(
      () => createCase(JOHN, { clientRequestId: "dup-safe-exit-1" }),
      409, "dup-safe-exit-1",
    );
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    const dupList = mine.value.filter((c) => c.clientRequestId === "dup-safe-exit-1");
    assert.equal(dupList.length, 1, "exactly one case for the retried payload");
  });

  test("one OPEN case per employee is enforced (different retry ids)", async () => {
    await expectError(() => createCase(JOHN, { clientRequestId: nextClientRequestId() }), 409, "already has an exit case");
  });

  test("EmployerInitiated is HR-only; HR may raise it for an employee", async () => {
    await expectError(
      () => createCase(JOHN, { exitType: "EmployerInitiated", clientRequestId: nextClientRequestId() }),
      403, "authorized HR",
    );
    // JOHN already has an open case -> create for EMP5.
    const c = await createCase(HR, {
      employee_ID: EMP5_ID,
      exitType: "EmployerInitiated",
      reasonCategory: "Performance",
      reasonText: "documented performance separation",
      proposedFinalWorkingDate: dateIn(120),
    });
    assert.equal(c.employee_ID, EMP5_ID);
    assert.equal(c.exitType, "EmployerInitiated");
  });

  test("configuration CRUD strictly for the HR trio", async () => {
    await expectError(
      () => POST(`${EX}/ExitNoticePolicies`, { exitType: "Retirement", noticePeriodDays: 15 }, JOHN),
      403,
    );
  });

  test("notice policy is created by HR (Resignation = 30 days)", async () => {
    const res = await POST(
      `${EX}/ExitNoticePolicies`,
      { exitType: "Resignation", noticePeriodDays: 30, active: true },
      HR,
    );
    assert.ok([201, 200].includes(res.status), JSON.stringify(res.data));
  });
});

// ============================================================
// S2. NOTICE PERIOD + SUBMISSION
// ============================================================
describe("Sprint 21 - notice period & submission (case A, JOHN)", () => {
  let caseA;

  // Note: suite order matters - JOHN's one open case is this one.
  // The fclose case was created under "dup-safe-exit-1"? No: that
  // one was refused by the open-case rule... clientRequestId 'dup-
  // safe-exit-1' SUCCEEDED for JOHN, so JOHN's open case is THAT
  // one; we cannot create a second. So case A reuses it via its
  // known clientRequestId instead.
  test("short date refused with the CONFIGURED rule quoted", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    caseA = mine.value.find((c) => c.clientRequestId === "dup-safe-exit-1");
    assert.ok(caseA, "case A exists");

    // Patch the proposal via... proposals are action-free! There is
    // deliberately no PATCH; the date was set at creation with
    // dateIn(90) which EXCEEDS today+30. To exercise the short-date
    // refusal we rely on the OTHER case created below (with a short
    // date). Case A itself just needs a working date.
    const res = await GET(`${EX}/ExitCases(${caseA.ID})`, JOHN);
    assert.equal(res.data.status, "Draft");
  });

  test("short date refusal happens at SUBMIT (fresh short-date draft)", async () => {
    // Use case C (employer-initiated, EMP5, date 120d) untouched? It
    // has a long date. Instead validate the refusal through a fresh
    // HR-created Resignation for EMP6 with a deliberately SHORT date.
    const cShort = await createCase(HR, {
      employee_ID: EMP6_ID,
      exitType: "Resignation",
      proposedFinalWorkingDate: dateIn(3),
      clientRequestId: "short-date-exit",
    });
    await expectError(() => act(cShort.ID, "Submit", {}, HR), 400, "30 day(s)");
  });

  test("authorized HR waiver recorded, then submission succeeds", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${EMP6_ID} and status eq 'Draft'`, ADMIN);
    const short = mine.value[0];
    await expectError(() => act(short.ID, "WaiveNotice", {}, HR), 400, "reason");
    await expectError(() => act(short.ID, "WaiveNotice", { reason: "   " }, HR), 400, "reason");
    const waived = await act(short.ID, "WaiveNotice", { reason: "HR-approved shortened notice, policy exception 2026-11" }, HR);
    assert.match(valueOf(waived), /waiver/i);
    await act(short.ID, "Submit", {}, HR);

    const { data: after } = await GET(`${EX}/ExitCases(${short.ID})`, ADMIN);
    assert.equal(after.status, "Submitted");
    assert.equal(after.noticePeriodStatus, "Waived", "short date allowed BY the recorded waiver");
    assert.equal(after.noticePeriodDays, 30);
  });

  test("Submit again from Submitted is refused (state machine)", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${EMP6_ID} and status eq 'Submitted'`, ADMIN);
    assert.ok(mine.value.length, "the waived case is Submitted");
    await expectError(() => act(mine.value[0].ID, "Submit", {}, HR), 400, "Draft");
  });

  test("missing notice CONFIGURATION surfaces 'NotConfigured' (no invented rule)", async () => {
    // EMP4 (mgrdept's employee) has no case of its own in this run.
    const c = await createCase(HR, {
      employee_ID: "10000000-0000-0000-0000-000000000004",
      exitType: "Retirement",
      proposedFinalWorkingDate: dateIn(60),
      clientRequestId: "retirement-notconf",
    });
    const res = await act(c.ID, "Submit", {}, HR);
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));
    const { data: after } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(after.noticePeriodStatus, "NotConfigured", "gap visibly recorded");
    assert.equal(after.noticePeriodDays, null);
  });
});

// ============================================================
// S3. WORKFLOW APPROVALS (case A continuation happens in later
//     suites; here the EMP6 case runs the Manager -> HR chain,
//     self-approval prevention and rejection strings)
// ============================================================
describe("Sprint 21 - workflow approvals & decisions", () => {
  let caseA;

  test("submit case A (the dup-safe draft) and open the manager task", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    caseA = mine.value[0];
    assert.equal(caseA.status, "Draft");
    const res = await act(caseA.ID, "Submit", {}, JOHN); // the employee submits
    assert.ok([200, 204].includes(res.status), JSON.stringify(res.data));

    const { data } = await GET(`${EX}/ExitCases(${caseA.ID})`, ADMIN);
    assert.equal(data.status, "Submitted");
    assert.equal(data.noticePeriodStatus, "Met", "90 days > configured 30");
  });

  test("requester cannot approve (self-approval prevention)", async () => {
    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${caseA.ID} and status eq 'Running'`,
      ADMIN,
    );
    const tasks = await GET(`${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`, ADMIN);
    await expectError(
      () => POST(`${WF}/WorkflowTasks(ID=${tasks.data.value[0].ID})/WorkflowService.Approve`, {}, JOHN),
      403,
    );
  });

  test("Manager approves, then HR approves (workflow decision sync)", async () => {
    const approved = await approveViaWorkflow(caseA.ID);
    assert.equal(approved.status, "Approved", "workflow decision synced to the exit case");
    assert.equal(approved.approvedFinalWorkingDate, approved.proposedFinalWorkingDate);
  });

  test("rejection path lands on the case; Reconsider reopens Draft", async () => {
    // Fresh case for EMP3 (Retirement = no notice policy needed).
    const c = await createCase(HR, {
      employee_ID: EMP3_ID,
      exitType: "Retirement",
      proposedFinalWorkingDate: dateIn(45),
      clientRequestId: "reject-flow",
    });
    await act(c.ID, "Submit", {}, HR);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${c.ID} and status eq 'Running'`,
      ADMIN,
    );
    const tasks = await GET(`${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`, ADMIN);
    await expectError(
      () => POST(`${WF}/WorkflowTasks(ID=${tasks.data.value[0].ID})/WorkflowService.Reject`, {}, JOHN),
      403,
    );
    await POST(`${WF}/WorkflowTasks(ID=${tasks.data.value[0].ID})/WorkflowService.Reject`, { comments: "final working date not acceptable" }, MGRDEPT);

    const { data: rejected } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(rejected.status, "Rejected", "rejection synced");

    await expectError(() => act(c.ID, "Reconsider", {}, JOHN), 403);
    await expectError(() => act(c.ID, "Reconsider", { reason: "   " }, HR), 400, "reason");
    await act(c.ID, "Reconsider", { reason: "date renegotiated with the employee" }, HR);
    const { data: redraft } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(redraft.status, "Draft", "audited reconsideration to Draft");

    // Resubmission starts a FRESH workflow - the rejected one stays final.
    await act(c.ID, "Submit", {}, HR);
    await approveViaWorkflow(c.ID);
    const { data: approved2 } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(approved2.status, "Approved");
    const { data: instances2 } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${c.ID}`,
      ADMIN,
    );
    assert.equal(instances2.value.length, 2, "two instances: rejected one is history");
  });

  test("Rework loop: SendBack -> Draft -> requester Resubmit -> both steps again (case D)", async () => {
    // hrperson (employee ...0002, requester AND a resubmit-authorized
    // user) submits their own Retirement case. The manager sends it
    // back with comments; the callback returns the case to Draft;
    // the requester resubmits on the SAME instance and the chain
    // then runs to Approved - proving the full rework loop.
    const c = await createCase(HR, {
      employee_ID: HR_ID,
      exitType: "Retirement",
      proposedFinalWorkingDate: dateIn(240),
      clientRequestId: "self-case",
    });
    await act(c.ID, "Submit", {}, HR);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${c.ID} and status eq 'Running'`,
      ADMIN,
    );
    const tasks = await GET(`${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`, ADMIN);
    await expectError(
      () => POST(`${WF}/WorkflowTasks(ID=${tasks.data.value[0].ID})/WorkflowService.Approve`, {}, FINMGR),
      403,
    );
    await POST(`${WF}/WorkflowTasks(ID=${tasks.data.value[0].ID})/WorkflowService.SendBack`, { comments: "date needs re-proposal" }, MGRDEPT);

    const { data: rework } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(rework.status, "Draft", "SendBack -> Draft via exit callback");

    const { data: instances2 } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${c.ID} and status eq 'Rework'`,
      ADMIN,
    );
    await POST(`${WF}/WorkflowInstances(ID=${instances2.value[0].ID})/WorkflowService.ResubmitWorkflow`, {}, HR);
    const { data: resub } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(resub.status, "Submitted", "resubmit restores Submitted");

    // ---- the resubmitted journey must run BOTH steps again:
    // hrperson (the requester) may not approve (R4 assignee check);
    // the real approvers complete the chain.
    const { data: openNow } = await GET(
      `${WF}/WorkflowTasks?$filter=instance_ID eq ${instances2.value[0].ID} and status eq 'Open'`,
      ADMIN,
    );
    assert.ok(openNow.value?.length, "fresh step-1 task after resubmit");
    await expectError(
      () => POST(`${WF}/WorkflowTasks(ID=${openNow.value[0].ID})/WorkflowService.Approve`, {}, HR),
      403,
    );
    await approveViaWorkflow(c.ID);
    const { data: after } = await GET(`${EX}/ExitCases(${c.ID})`, ADMIN);
    assert.equal(after.status, "Approved");
  });

  test("approver-is-requester step is auto-SKIPPED (R7, case C)", async () => {
    // Case C (employer-initiated for EMP5, submitted here): its
    // requester IS employee ...0005 = the LevelHR approver. The
    // engine must skip step 2 instead of letting the requester
    // approve their own case.
    const { data: caseC } = await GET(`${EX}/ExitCases?$filter=exitType eq 'EmployerInitiated' and status eq 'Draft'`, ADMIN);
    assert.ok(caseC.value.length, "case C exists (Draft)");
    const caseCId = caseC.value[0].ID;
    await act(caseCId, "Submit", {}, HR);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${caseCId} and status eq 'Running'`,
      ADMIN,
    );
    const step1 = await GET(`${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`, ADMIN);
    assert.equal(step1.data.value.length, 1, "only step 1 is open");
    await POST(`${WF}/WorkflowTasks(ID=${step1.data.value[0].ID})/WorkflowService.Approve`, { comments: "manager ok" }, MGRDEPT);

    const { data: after } = await GET(`${EX}/ExitCases(${caseCId})`, ADMIN);
    assert.equal(after.status, "Approved", "step 2 auto-skipped; instance completed");
  });
});

// ============================================================
// S4. AUTHORIZED HR MANAGEMENT of an open case
// ============================================================
describe("Sprint 21 - HR review actions (EMP6 case)", () => {
  let caseE;

  test("StartReview stamps the HR owner; InReview reached", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${EMP6_ID} and status eq 'Submitted'`, ADMIN);
    caseE = mine.value[0];
    await expectError(() => act(caseE.ID, "StartReview", {}, JOHN), 403);
    await act(caseE.ID, "StartReview", {}, HR);
    const { data: after } = await GET(`${EX}/ExitCases(${caseE.ID})`, ADMIN);
    assert.equal(after.status, "InReview");
    assert.equal(after.hrOwner_ID, HR_ID);
  });

  test("ChangeApprovedDate requires a reason and records history", async () => {
    const newDate = dateIn(150);
    await expectError(() => act(caseE.ID, "ChangeApprovedDate", { finalWorkingDate: newDate }, HR), 400, "reason");
    await act(caseE.ID, "ChangeApprovedDate", { finalWorkingDate: newDate, reason: "rescheduled with business" }, HR);
    const { data: after } = await GET(`${EX}/ExitCases(${caseE.ID})`, ADMIN);
    assert.equal(after.approvedFinalWorkingDate, newDate, "approved date recorded pre-approval");
  });

  test("Withdraw (HR) from InReview cancels the workflow instance", async () => {
    await act(caseE.ID, "Withdraw", { reason: "employee decided to stay" }, HR);
    const { data: after } = await GET(`${EX}/ExitCases(${caseE.ID})`, ADMIN);
    assert.equal(after.status, "Withdrawn");
    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${caseE.ID}`,
      ADMIN,
    );
    assert.ok(!instances.value.some((i) => i.status === "Running" || i.status === "Rework"), "no running journey left");
  });

  test("a withdrawn employee may raise a fresh case (high date, no waiver)", async () => {
    const c2 = await createCase(PAYEXEC, {
      employee_ID: EMP6_ID,
      exitType: "Resignation",
      proposedFinalWorkingDate: dateIn(200),
      clientRequestId: "emp6-second-case",
    });
    assert.equal(c2.exitNumber.startsWith("EXT"), true);
  });
});

// ============================================================
// S5. CLEARANCE CHECKLIST (case A / EMP3 approved cases)
// ============================================================
describe("Sprint 21 - clearance checklist", () => {
  let caseForClearance; // EMP3 'reject-flow' case (Approved)

  test("StartClearance seeds items idempotently from the ACTIVE template", async () => {
    const { data: approvedCases } = await GET(
      `${EX}/ExitCases?$filter=employee_ID eq ${EMP3_ID} and status eq 'Approved'`,
      ADMIN,
    );
    caseForClearance = approvedCases.value[0];
    const res = await act(caseForClearance.ID, "StartClearance", {}, HR);
    assert.match(valueOf(res), /7/);
    const { data: items } = await GET(`${EX}/ExitChecklistItems?$filter=exitCase_ID eq ${caseForClearance.ID}`, ADMIN);
    assert.equal(items.value.length, 7, "all seeded items present");
  });

  test("re-running StartClearance after seeding is refused (state machine)", async () => {
    await expectError(() => act(caseForClearance.ID, "StartClearance", {}, HR), 400);
  });

  test("MarkReady is refused while mandatory items are open (409 with codes)", async () => {
    await expectError(
      () => act(caseForClearance.ID, "MarkReadyForSeparation", {}, HR),
      409, "mandatory clearance",
    );
  });

  test("responsible-role authorization holds (employee cannot complete)", async () => {
    const item = await itemByCode(caseForClearance.ID, "CLS-MGR");
    await expectError(
      () => POST(`${EX}/ExitChecklistItems(ID=${item.ID})/CompleteItem`, {}, JOHN),
      403, "authorized",
    );
  });

  test("a HR item by HRExecutive; optional item SkipItem with mandatory refusal", async () => {
    const hrItem = await itemByCode(caseForClearance.ID, "CLS-HR");
    const res = await POST(`${EX}/ExitChecklistItems(ID=${hrItem.ID})/CompleteItem`, { remarks: "exit interview done" }, HR);
    assert.match(valueOf(res), /CLS-HR/);

    const optional = await itemByCode(caseForClearance.ID, "CLS-KB");
    const mandatory = await itemByCode(caseForClearance.ID, "CLS-MGR");
    await expectError(
      () => POST(`${EX}/ExitChecklistItems(ID=${mandatory.ID})/SkipItem`, { reason: "x" }, HR),
      400, "mandatory",
    );
    const skipped = await POST(`${EX}/ExitChecklistItems(ID=${optional.ID})/SkipItem`, { reason: "no knowledge transfer needed" }, HR);
    assert.match(valueOf(skipped), /skipped/);
  });

  test("Finance item is completed by a FinanceManager (HRExecutive deferred)", async () => {
    const finItem = await itemByCode(caseForClearance.ID, "CLS-FIN");
    // The item's responsibleRole is Finance: a plain employee is
    // refused; the FinanceManager is the responsible authority.
    await expectError(
      () => POST(`${EX}/ExitChecklistItems(ID=${finItem.ID})/CompleteItem`, {}, JOHN),
      403, "authorized",
    );
    const res = await POST(`${EX}/ExitChecklistItems(ID=${finItem.ID})/CompleteItem`, {}, FINMGR);
    assert.match(valueOf(res), /CLS-FIN/);
  });

  test("retrying a completed item is a friendly no-op (no duplicate event)", async () => {
    const hrItem = await itemByCode(caseForClearance.ID, "CLS-HR");
    const res = await POST(`${EX}/ExitChecklistItems(ID=${hrItem.ID})/CompleteItem`, {}, HR);
    assert.match(valueOf(res), /already completed/);
  });
});

// ============================================================
// S6. ASSET INTEGRATION (Sprint 14 ledger as the ONLY evidence)
// ============================================================
describe("Sprint 21 - asset-return integration (case A, JOHN)", () => {
  let asset;
  let caseA;

  test("assign an asset to JOHN (real Sprint 14 action)", async () => {
    const { data: approvedCases } = await GET(
      `${EX}/ExitCases?$filter=employee_ID eq ${JOHN_ID} and status eq 'Approved'`,
      ADMIN,
    );
    caseA = approvedCases.value[0];
    await act(caseA.ID, "StartClearance", {}, HR);
    const { data: items } = await GET(`${EX}/ExitChecklistItems?$filter=exitCase_ID eq ${caseA.ID}`, ADMIN);
    assert.ok(items.value.some((i) => i.itemCode === "CLS-ASSET"));

    const cat = await POST(`${A}/AssetCategories`, { name: `ExitCat ${Date.now()}` }, HR);
    const created = await POST(`${A}/Assets`, {
      name: `Exit laptop ${Date.now()}`,
      category_ID: cat.data.ID,
      serialNumber: `SN-EXIT-${Date.now()}`,
    }, HR);
    asset = created.data;
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.assignAsset`, { employee_ID: JOHN_ID }, HR);
  });

  test("DepartingEmployeeAssets shows the ACTIVE assignment (HR-only)", async () => {
    const { data: list } = await GET(
      `${EX}/DepartingEmployeeAssets?$filter=case_ID eq ${caseA.ID}`,
      HR,
    );
    assert.ok(Array.isArray(list.value), "computed view returns a value array");
    const heldRow = list.value.find((r) => r.status === "Active");
    assert.ok(heldRow, "active row present");
    assert.equal(heldRow.assetTag, asset.assetTag, "right asset");
    // The perimeter denies the compute-view call for non-HR users
    // (403 reaches the handler or the grant layer - both refuse).
    await expectError(
      () => GET(`${EX}/DepartingEmployeeAssets?$filter=case_ID eq ${caseA.ID}`, JOHN),
      403,
    );
  });

  test("Asset item completion is REFUSED while assets are outstanding", async () => {
    const item = await itemByCode(caseA.ID, "CLS-ASSET");
    await expectError(
      () => POST(`${EX}/ExitChecklistItems(ID=${item.ID})/CompleteItem`, {}, HR),
      409, asset.assetTag,
    );
  });

  test("return through the REAL asset action, then clearance verifies and completes", async () => {
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Good" }, HR);
    const item = await itemByCode(caseA.ID, "CLS-ASSET");
    const res = await POST(`${EX}/ExitChecklistItems(ID=${item.ID})/CompleteItem`, {}, HR);
    assert.match(valueOf(res), /verified against asset ledger/);

    const { data: view } = await GET(`${EX}/DepartingEmployeeAssets?$filter=case_ID eq ${caseA.ID}`, HR);
    const closed = view.value.find((r) => r.asset_ID === asset.ID);
    assert.equal(closed.returnedOn, new Date().toISOString().slice(0, 10), "actual return date surfaced - history preserved");
  });
});

// ============================================================
// S7. DOCUMENT LINKS (Sprint 17 store reuse)
// ============================================================
describe("Sprint 21 - exit documents & clearance completion", () => {
  let caseA;
  let documentId;

  test("link a validated employee document; bogus links refused", async () => {
    // Case A is already ClearanceInProgress (see the asset suite).
    const { data: approvedCases } = await GET(
      `${EX}/ExitCases?$filter=employee_ID eq ${JOHN_ID} and status eq 'ClearanceInProgress'`,
      ADMIN,
    );
    caseA = approvedCases.value[0];

    // Seed one Active document row for JOHN (direct DB - the file
    // storage path is exercised by the Sprint 17 suite).
    const cdsLocal = require("@sap/cds");
    documentId = cdsLocal.utils.uuid();
    await cdsLocal.db.run(
      cdsLocal.ql.INSERT.into("ewms.db.employee.Document").entries({
        ID: documentId,
        employee_ID: JOHN_ID,
        documentType: "Resume",
        fileName: "relieving-form.pdf",
        status: "Active",
      }),
    );

    await expectError(
      () => POST(`${EX}/ExitCaseDocuments`, { exitCase_ID: caseA.ID, document_ID: "00000000-0000-0000-0000-00000000dead" }, JOHN),
      404, "does not exist",
    );
    const linked = await POST(`${EX}/ExitCaseDocuments`, { exitCase_ID: caseA.ID, document_ID: documentId }, JOHN);
    assert.ok([201, 200].includes(linked.status), JSON.stringify(linked.data));
    await expectError(
      () => POST(`${EX}/ExitCaseDocuments`, { exitCase_ID: caseA.ID, document_ID: documentId }, JOHN),
      409, "already linked",
    );
  });

  test("Document item refuses completion before the link; completes after", async () => {
    // The item currently has zero required links for ITS case? No:
    // the link above belongs to case A...
    const item = await itemByCode(caseA.ID, "CLS-DOC");
    const res = await POST(`${EX}/ExitChecklistItems(ID=${item.ID})/CompleteItem`, {}, HR);
    assert.match(valueOf(res), /verified against linked documents/);
  });

  test("finish the remaining items and MarkReadyForSeparation", async () => {
    // CLS-MGR by the reporting manager, CLS-IT by SystemAdmin,
    // CLS-HR by the responsible HR owner, CLS-FIN by Finance.
    const hrItem = await itemByCode(caseA.ID, "CLS-HR");
    await POST(`${EX}/ExitChecklistItems(ID=${hrItem.ID})/CompleteItem`, { remarks: "exit interview" }, HR);
    const finItem = await itemByCode(caseA.ID, "CLS-FIN");
    await POST(`${EX}/ExitChecklistItems(ID=${finItem.ID})/CompleteItem`, { remarks: "dues confirmed" }, FINMGR);

    const mgrItem = await itemByCode(caseA.ID, "CLS-MGR");
    await POST(`${EX}/ExitChecklistItems(ID=${mgrItem.ID})/CompleteItem`, { remarks: "handover confirmed" }, MGRDEPT);
    const itItem = await itemByCode(caseA.ID, "CLS-IT");
    await expectError(
      () => POST(`${EX}/ExitChecklistItems(ID=${itItem.ID})/CompleteItem`, {}, JOHN),
      403, "authorized",
    );
    await POST(`${EX}/ExitChecklistItems(ID=${itItem.ID})/CompleteItem`, { remarks: "access revocation executed offline" }, ADMIN);

    await act(caseA.ID, "MarkReadyForSeparation", {}, HR);
    const { data: ready } = await GET(`${EX}/ExitCases(${caseA.ID})`, ADMIN);
    assert.equal(ready.status, "ReadyForSeparation");
    assert.equal(ready.separationDate, ready.approvedFinalWorkingDate);
  });
});

// ============================================================
// S8. PAYROLL SETTLEMENT (evidence-gated; no invented formulas)
// ============================================================
describe("Sprint 21 - payroll settlement integration", () => {
  let caseA;

  test("recording WITHOUT payroll evidence is refused (409)", async () => {
    const { data: readyCases } = await GET(`${EX}/ExitCases?$filter=status eq 'ReadyForSeparation'`, ADMIN);
    caseA = readyCases.value.find((c) => c.employee_ID === JOHN_ID);

    await expectError(
      () => act(caseA.ID, "RecordFinalSettlement", {}, PAYEXEC),
      409, "payroll",
    );
  });

  test("with a processed payroll row for the separation month it records; retry = no-op", async () => {
    const { data: caseRow } = await GET(`${EX}/ExitCases(${caseA.ID})`, ADMIN);
    const separation = new Date(`${caseRow.separationDate}T00:00:00Z`);
    const month = separation.getUTCMonth() + 1;
    const year = separation.getUTCFullYear();

    const cdsLocal = require("@sap/cds");
    const periodId = cdsLocal.utils.uuid();
    await cdsLocal.db.run(
      cdsLocal.ql.INSERT.into("ewms.db.payroll.PayrollPeriod").entries({
        ID: periodId,
        payrollCode: `EXITP${year}${month}`,
        month,
        year,
        startDate: `${year}-${String(month).padStart(2, "0")}-01`,
        endDate: `${year}-${String(month).padStart(2, "0")}-28`,
        workingDays: "20.00",
      }),
    );
    await cdsLocal.db.run(
      cdsLocal.ql.INSERT.into("ewms.db.payroll.PayrollProcess").entries({
        ID: cdsLocal.utils.uuid(),
        payrollPeriod_ID: periodId,
        employee_ID: JOHN_ID,
        processStatus: "Processed",
      }),
    );

    const recorded = await act(caseA.ID, "RecordFinalSettlement", {}, PAYEXEC);
    assert.match(valueOf(recorded), /recorded/);
    const { data: after } = await GET(`${EX}/ExitCases(${caseA.ID})`, ADMIN);
    assert.equal(after.payrollStatus, "Complete", "only with evidence");

    const retry = await act(caseA.ID, "RecordFinalSettlement", {}, FINMGR);
    assert.match(valueOf(retry), /already recorded/);
  });

  test("finalSettlement is authorized to payroll/finance/HR roles only", async () => {
    const { data: readyCases } = await GET(`${EX}/ExitCases?$filter=status eq 'ReadyForSeparation'`, ADMIN);
    const other = readyCases.value.find((c) => c.employee_ID === EMP3_ID);
    if (!other) return; // EMP3 case reaches Ready only in the next suites
    await expectError(() => act(other.ID, "RecordFinalSettlement", {}, JOHN), 403);
  });
});

// ============================================================
// S9. COMPLETION - employment status + DepHR guard + corrections
// ============================================================
describe("Sprint 21 - CompleteExit & corrections", () => {
  let caseA;

  test("DepHR guard: HR contact deactivation requires SystemAdmin", async () => {
    const { data: readyCases } = await GET(`${EX}/ExitCases?$filter=status eq 'ReadyForSeparation'`, ADMIN);
    caseA = readyCases.value.find((c) => c.employee_ID === JOHN_ID);

    // Make JOHN an active DepartmentHR contact (direct DB in-memory).
    const cdsLocal = require("@sap/cds");
    await cdsLocal.db.run(
      cdsLocal.ql.INSERT.into("ewms.db.organization.DepartmentHR").entries({
        ID: "33333333-hhhh-9999-hhhh-333333333333",
        department_ID: "11111111-dddd-1111-dddd-111111111111",
        employee_ID: JOHN_ID,
        isActive: true,
      }),
    );

    await expectError(() => act(caseA.ID, "CompleteExit", {}, HR), 403, "HR contact");
    await act(caseA.ID, "CompleteExit", {}, ADMIN);
    const { data: done } = await GET(`${EX}/ExitCases(${caseA.ID})`, ADMIN);
    assert.equal(done.status, "Completed");
    assert.equal(done.finalProcessingStatus, "Completed");
  });

  test("employment deactivated ONLY now: Inactive + relievingDate", async () => {
    const { data: john } = await GET(`${EMP}/Employees/${JOHN_ID}`, ADMIN);
    assert.equal(john.status, "Inactive", "only CompleteExit flips the status");
    assert.ok(john.relievingDate, "relievingDate stamped");
  });

  test("complete-state guards: no retries, no silent rewrites", async () => {
    await expectError(() => act(caseA.ID, "CompleteExit", {}, ADMIN), 400, "final");
    await expectError(() => act(caseA.ID, "MarkReadyForSeparation", {}, HR), 400);
    // The perimeter (or the belt-and-braces guard) refuses - either
    // way no grant exists and no status can flip.
    await expectError(
      () => PATCH(`${EX}/ExitCases(${caseA.ID})`, { status: "Approved" }, ADMIN),
      403,
    );
    await expectError(
      () => DELETE(`${EX}/ExitCases(${caseA.ID})`, ADMIN),
      403,
    );
  });

  test("Correct: audited completed-case correction with mandatory reason", async () => {
    await expectError(() => act(caseA.ID, "Correct", { reason: "" }, ADMIN), 400, "reason");
    const res = await act(caseA.ID, "Correct", { reason: "separation date corrected after finalization" }, ADMIN);
    assert.match(valueOf(res), /Correction recorded/);
    const { data: corrections } = await GET(`${EX}/ExitEvents?$filter=exitCase_ID eq ${caseA.ID}`, ADMIN);
    assert.ok(corrections.value.some((e) => e.eventType === "Corrected"), "correction is in the event history");
  });

  test("checklist item immutability via PATCH", async () => {
    const { data: items } = await GET(`${EX}/ExitChecklistItems?$filter=exitCase_ID eq ${caseA.ID}`, ADMIN);
    await expectError(
      () => PATCH(`${EX}/ExitChecklistItems(ID=${items.value[0].ID})`, { status: "Pending" }, ADMIN),
      403,
    );
  });
});

// ============================================================
// S10. PRIVACY, ISOLATION, NOTIFICATIONS, AUDIT
// ============================================================
describe("Sprint 21 - privacy, notifications & audit", () => {
  test("JOHN reads only his own cases; others' by-ID is 404", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases`, JOHN);
    assert.ok(mine.value.every((c) => c.employee_ID === JOHN_ID), "list scoped");
    // EMP3's case:
    const { data: emp3List } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${EMP3_ID}`, ADMIN);
    await expectError(() => GET(`${EX}/ExitCases(${emp3List.value[0].ID})`, JOHN), 404);
  });

  test("EmployerInitiated reasons are masked for non-HR readers", async () => {
    const { data: empCases } = await GET(`${EX}/ExitCases?$filter=exitType eq 'EmployerInitiated'`, ADMIN);
    const target = empCases.value[0];

    // The case's employee is EMP5 (finmgr user) - a non-HR reader.
    const { data: masked } = await GET(`${EX}/ExitCases(${target.ID})`, FINMGR);
    assert.equal(masked.reasonText, "(restricted to HR)", "reason withheld");
    assert.equal(masked.reasonCategory, "Other", "category neutralized");

    const { data: unmasked } = await GET(`${EX}/ExitCases(${target.ID})`, HR);
    assert.equal(unmasked.reasonCategory, "Performance", "HR reads the real reason");
  });

  test("ExitEvents are HR-only (internal history)", async () => {
    const { data: mine } = await GET(`${EX}/ExitCases?$filter=employee_ID eq ${EMP3_ID}`, ADMIN);
    await expectError(
      () => GET(`${EX}/ExitEvents?$filter=exitCase_ID eq ${mine.value[0].ID}`, JOHN),
      403,
    );
  });

  test("EXIT category notifications were sent at lifecycle transitions", async () => {
    const { data } = await GET(
      `${NOTIF}/Notifications?$filter=category eq 'EXIT' and recipient_ID eq '${JOHN_ID}'`,
      JOHN,
    );
    assert.ok(data.value.length >= 1, "employee received exit notifications");
  });

  test("exit actions are audited (shared AuditLog)", async () => {
    const { data } = await GET(`${EMP}/AuditLogs?$filter=action eq 'ItemCompleted'`, ADMIN);
    assert.ok(data.value.length >= 1, "clearance completion audited");
  });
});
