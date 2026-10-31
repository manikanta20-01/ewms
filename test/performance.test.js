// ============================================================
// SPRINT 13 - AUTOMATED TESTS: PERFORMANCE MANAGEMENT
// ------------------------------------------------------------
// Automated tests for the Performance Review + Goal capability.
//
// Testing approach (CAP-supported, same as every other suite):
//   * One CAP test server via the shared test/setup.js helper.
//   * CDS_ENV=test -> in-memory [test] profile database.
//   * Mock users come from package.json cds.requires.auth.users.
//   * No process.exit(), no fake servers - the runner exits
//     naturally when all suites finish.
// ============================================================

const { test, describe, before } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const harness = startTestHarness();

const GET = harness.GET;
const POST = harness.POST;
const PATCH = harness.PATCH;

// ------------------------------------------------------------
// Mock users (package.json) + seeded employee IDs
// ------------------------------------------------------------
const ADMIN = { auth: { username: "sysadmin", password: "" } }; // SystemAdmin (no Employee row)
const HR = { auth: { username: "hrperson", password: "" } }; // HRExecutive+HRAdmin, employee ...0002
const FINMGR = { auth: { username: "finmgr", password: "" } }; // FinanceManager, employee ...0005 = LevelHR approver
const JOHN = { auth: { username: "empjohn", password: "" } }; // plain Employee, ...0001
const DMGR = { auth: { username: "mgrdept", password: "" } }; // DepartmentManager, ...0004

const JOHN_EMP_ID = "10000000-0000-0000-0000-000000000001";
const HR_EMP_ID = "10000000-0000-0000-0000-000000000002";
const MGR_EMP_ID = "10000000-0000-0000-0000-000000000004";
const LEVELHR_EMP_ID = "10000000-0000-0000-0000-000000000005";

const P = "/odata/v4/performance";
const WF = "/odata/v4/workflow";
const NOT = "/odata/v4/notification";
const AUD = "/odata/v4/employee/AuditLogs";

let seq = 0;
const unique = () => `t${Date.now()}${++seq}`;

/** Unique review period per call - the duplicate guard is keyed
 *  on employee + type + period, so each test needs its own. */
function nextPeriod() {
  seq += 1;
  const month = String(((seq - 1) % 12) + 1).padStart(2, "0");
  const year = 2031 + Math.floor((seq - 1) / 12);
  return { periodStart: `${year}-${month}-01`, periodEnd: `${year}-${month}-28` };
}

/**
 * CAP's test facade THROWS on 4xx/5xx (err.response.status holds
 * the code). This helper asserts both code and optional message.
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

/** Creates a draft review (HR) and returns the row. */
async function createReview(overrides = {}) {
  const period = nextPeriod();
  const { status, data } = await POST(
    `${P}/Reviews`,
    {
      employee_ID: JOHN_EMP_ID,
      reviewer_ID: MGR_EMP_ID,
      title: `Review ${unique()}`,
      reviewType: "Annual",
      ...period,
      startDate: period.periodStart,
      dueDate: `${period.periodEnd.slice(0, 4)}-12-31`,
      ...overrides,
    },
    HR,
  );
  assert.equal(status, 201, `review create failed: ${JSON.stringify(data)}`);
  assert.equal(data.status, "Draft");
  return data;
}

/** Submits a review (starts the generic workflow). */
async function submitReview(reviewId) {
  const res = await POST(`${P}/Reviews(ID=${reviewId})/PerformanceService.SubmitReview`, {}, HR);
  assert.ok(res.status === 200 || res.status === 204, `submit failed: ${JSON.stringify(res.data)}`);
}

/** The LevelHR approver (finmgr) approves the review workflow task. */
async function approveViaWorkflow(reviewId) {
  const { data: instances } = await GET(
    `${WF}/WorkflowInstances?$filter=businessObjectId eq ${reviewId}&$select=ID`,
    ADMIN,
  );
  assert.equal(instances.value.length, 1, "one workflow instance for the review");
  const instanceId = instances.value[0].ID;

  const { data: tasks } = await GET(
    `${WF}/WorkflowTasks?$filter=instance_ID eq ${instanceId} and status eq 'Open'`,
    FINMGR,
  );
  assert.ok(tasks.value.length > 0, "approver has an open workflow task");

  const res = await POST(
    `${WF}/WorkflowTasks(ID=${tasks.value[0].ID})/WorkflowService.Approve`,
    { comments: "ok" },
    FINMGR,
  );
  assert.ok(res.status === 200 || res.status === 204, `approve failed: ${JSON.stringify(res.data)}`);

  const { data: review } = await GET(`${P}/Reviews(ID=${reviewId})`, HR);
  assert.equal(review.status, "Approved", "workflow approval synced the review status");
  return review;
}

/** Creates a draft goal (HR) and returns the row. */
async function createGoal(overrides = {}) {
  const { status, data } = await POST(
    `${P}/Goals`,
    {
      employee_ID: JOHN_EMP_ID,
      assignedBy_ID: MGR_EMP_ID,
      title: `Goal ${unique()}`,
      description: "Improve delivery quality",
      category: "Technical",
      weight: 20,
      target: "Defect rate below 2%",
      measurementCriteria: "Monthly QA report",
      dueDate: "2099-06-30",
      ...overrides,
    },
    HR,
  );
  assert.equal(status, 201, `goal create failed: ${JSON.stringify(data)}`);
  assert.equal(data.status, "Draft");
  return data;
}

// ============================================================
// A. MODEL / CRUD
// ============================================================
describe("Sprint 13 - A. Model / CRUD", () => {
  test("creates a review with auto code, Draft status, associations", async () => {
    const review = await createReview();
    assert.ok(review.reviewCode?.startsWith("REV"), "auto review code");
    assert.equal(review.employee_ID, JOHN_EMP_ID);
    assert.equal(review.reviewer_ID, MGR_EMP_ID);
  });

  test("reads a review", async () => {
    const review = await createReview();
    const { status, data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.equal(status, 200);
    assert.equal(data.ID, review.ID);
    assert.equal(data.title, review.title);
  });

  test("updates allowed review fields (title)", async () => {
    const review = await createReview();
    const res = await PATCH(`${P}/Reviews(ID=${review.ID})`, { title: "Updated title" }, HR);
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.equal(data.title, "Updated title");
  });

  test("creates a goal with auto code, Draft status", async () => {
    const goal = await createGoal();
    assert.ok(goal.goalCode?.startsWith("GOAL"), "auto goal code");
    assert.equal(goal.status, "Draft");
    assert.equal(goal.employee_ID, JOHN_EMP_ID);
    assert.equal(goal.assignedBy_ID, MGR_EMP_ID);
  });

  test("reads a goal", async () => {
    const goal = await createGoal();
    const { status, data } = await GET(`${P}/Goals(ID=${goal.ID})`, HR);
    assert.equal(status, 200);
    assert.equal(data.ID, goal.ID);
  });

  test("updates allowed goal fields (target)", async () => {
    const goal = await createGoal();
    const res = await PATCH(`${P}/Goals(ID=${goal.ID})`, { target: "New target" }, HR);
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${P}/Goals(ID=${goal.ID})`, HR);
    assert.equal(data.target, "New target");
  });
});

// ============================================================
// B. AUTHORIZATION
// ============================================================
describe("Sprint 13 - B. Authorization", () => {
  let review;

  before(async () => {
    review = await createReview();
  });

  test("employee can read their own review", async () => {
    const { status, data } = await GET(`${P}/Reviews(ID=${review.ID})`, JOHN);
    assert.equal(status, 200);
    assert.equal(data.ID, review.ID);
  });

  test("employee CANNOT read another employee's review (row-level)", async () => {
    // A review about the Department Manager, reviewed by HR.
    const other = await createReview({
      employee_ID: MGR_EMP_ID,
      reviewer_ID: HR_EMP_ID,
    });
    await expectError(async () => {
      await GET(`${P}/Reviews(ID=${other.ID})`, JOHN);
    }, 404);
  });

  test("assigned reviewer can read the review", async () => {
    const { status, data } = await GET(`${P}/Reviews(ID=${review.ID})`, DMGR);
    assert.equal(status, 200);
    assert.equal(data.ID, review.ID);
  });

  test("plain employee cannot act on a review (403 on actions)", async () => {
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, JOHN);
    }, 403);
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.ApproveReview`, {}, JOHN);
    }, 403);
  });

  test("non-HR reviewer cannot cancel a review", async () => {
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.CancelReview`, { comments: "no" }, DMGR);
    }, 403);
  });

  test("goal assignee can read assigned goals but not others", async () => {
    const goal = await createGoal(); // assignedBy = mgrdept
    const { status, data } = await GET(`${P}/Goals(ID=${goal.ID})`, DMGR);
    assert.equal(status, 200);
    assert.equal(data.ID, goal.ID);

    // JOHN is the goal OWNER, not the assignee -> no read.
    const other = await createGoal({ employee_ID: MGR_EMP_ID });
    await expectError(async () => {
      await GET(`${P}/Goals(ID=${other.ID})`, JOHN);
    }, 404);
  });
});

// ============================================================
// C. GOAL LIFECYCLE
// ============================================================
describe("Sprint 13 - C. Goal lifecycle", () => {
  test("DRAFT -> ACTIVE (assignee activates)", async () => {
    const goal = await createGoal();
    const res = await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.ActivateGoal`, {}, DMGR);
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${P}/Goals(ID=${goal.ID})`, HR);
    assert.equal(data.status, "Active");
  });

  test("ACTIVE -> COMPLETED (with achievement + valid rating)", async () => {
    const goal = await createGoal();
    await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.ActivateGoal`, {}, DMGR);
    await POST(
      `${P}/Goals(ID=${goal.ID})/PerformanceService.CompleteGoal`,
      { achievement: "Defect rate reduced to 1.4%", rating: "ExceedsExpectations" },
      DMGR,
    );
    const { data } = await GET(`${P}/Goals(ID=${goal.ID})`, HR);
    assert.equal(data.status, "Completed");
    assert.equal(data.rating, "ExceedsExpectations");
    assert.ok(data.completedAt, "completedAt recorded");
  });

  test("DRAFT -> CANCELLED is allowed", async () => {
    const goal = await createGoal();
    await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.CancelGoal`, { comments: "obsolete" }, HR);
    const { data } = await GET(`${P}/Goals(ID=${goal.ID})`, HR);
    assert.equal(data.status, "Cancelled");
  });

  test("invalid transitions are rejected", async () => {
    // Complete straight from Draft.
    const g1 = await createGoal();
    await expectError(async () => {
      await POST(`${P}/Goals(ID=${g1.ID})/PerformanceService.CompleteGoal`, {}, HR);
    }, 400, /Draft' to 'Completed'/);

    // Re-activate a cancelled goal.
    const g2 = await createGoal();
    await POST(`${P}/Goals(ID=${g2.ID})/PerformanceService.CancelGoal`, {}, HR);
    await expectError(async () => {
      await POST(`${P}/Goals(ID=${g2.ID})/PerformanceService.ActivateGoal`, {}, HR);
    }, 400, /Cancelled' to 'Active'/);

    // Complete an already completed goal (idempotency safety).
    const g3 = await createGoal();
    await POST(`${P}/Goals(ID=${g3.ID})/PerformanceService.ActivateGoal`, {}, DMGR);
    await POST(`${P}/Goals(ID=${g3.ID})/PerformanceService.CompleteGoal`, {}, DMGR);
    await expectError(async () => {
      await POST(`${P}/Goals(ID=${g3.ID})/PerformanceService.CompleteGoal`, {}, HR);
    }, 400);
  });

  test("PATCH cannot bypass the goal lifecycle (status)", async () => {
    const goal = await createGoal();
    await expectError(async () => {
      await PATCH(`${P}/Goals(ID=${goal.ID})`, { status: "Completed" }, HR);
    }, 400, /lifecycle actions/);
  });
});

// ============================================================
// D. REVIEW LIFECYCLE
// ============================================================
describe("Sprint 13 - D. Review lifecycle", () => {
  test("full journey: Draft -> PendingReview -> InReview -> Submitted -> Approved -> Completed", async () => {
    const review = await createReview();
    await submitReview(review.ID);

    let { data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.equal(data.status, "PendingReview");

    // Reviewer starts the evaluation.
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    ({ data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR));
    assert.equal(data.status, "InReview");

    // Reviewer hands in the evaluation with a valid rating.
    await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
      { overallRating: "MeetsExpectations", comments: "Solid performance." },
      DMGR,
    );
    ({ data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR));
    assert.equal(data.status, "Submitted");
    assert.equal(data.overallRating, "MeetsExpectations");
    assert.ok(data.submittedAt, "submittedAt recorded");

    // Workflow approval -> Approved.
    await approveViaWorkflow(review.ID);

    // HR completes the review -> frozen.
    await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.CompleteReview`,
      { finalComments: "Finalized for the annual cycle." },
      HR,
    );
    ({ data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR));
    assert.equal(data.status, "Completed");
    assert.ok(data.completedAt, "completedAt recorded");

    // Frozen: no further modification of any kind.
    await expectError(async () => {
      await PATCH(`${P}/Reviews(ID=${review.ID})`, { title: "nope" }, HR);
    }, 400, /frozen/);
  });

  test("invalid review transitions are rejected", async () => {
    const review = await createReview();
    // Draft cannot be started... wait: Draft CAN be submitted, but
    // StartReview from Draft is invalid.
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    }, 400, /Draft' to 'InReview'/);

    // SubmitEvaluation from PendingReview is invalid.
    await submitReview(review.ID);
    await expectError(async () => {
      await POST(
        `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
        { overallRating: "Outstanding" },
        DMGR,
      );
    }, 400, /PendingReview' to 'Submitted'/);

    // CompleteReview before approval is invalid.
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
      { overallRating: "Outstanding" },
      DMGR,
    );
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.CompleteReview`, {}, HR);
    }, 400, /Submitted' to 'Completed'/);
  });

  test("cancellation rules: Draft can be cancelled; cancelled reviews are final", async () => {
    const review = await createReview();
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.CancelReview`, { comments: "reorg" }, HR);
    const { data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.equal(data.status, "Cancelled");

    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitReview`, {}, HR);
    }, 400);
  });

  test("employee comments action works on own non-frozen review", async () => {
    const review = await createReview();
    const res = await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.AddEmployeeComments`,
      { comments: "I would like to highlight the Q3 project delivery." },
      JOHN,
    );
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.match(data.employeeComments, /Q3 project delivery/);
  });
});

// ============================================================
// E. WORKFLOW INTEGRATION
// ============================================================
describe("Sprint 13 - E. Workflow integration", () => {
  test("SubmitReview creates a generic workflow instance + task for the LevelHR approver", async () => {
    const review = await createReview();
    await submitReview(review.ID);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${review.ID}`,
      ADMIN,
    );
    assert.equal(instances.value.length, 1, "one instance for the review");
    assert.equal(instances.value[0].businessObjectType, "ewms.db.performance.PerformanceReview");

    const { data: tasks } = await GET(
      `${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`,
      FINMGR,
    );
    assert.equal(tasks.value.length, 1, "LevelHR approver has exactly one open task");
  });

  test("unauthorized user cannot approve the workflow task", async () => {
    const review = await createReview();
    await submitReview(review.ID);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${review.ID}`,
      ADMIN,
    );
    const { data: tasks } = await GET(
      `${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`,
      FINMGR,
    );

    // JOHN is neither assignee nor delegate -> engine blocks.
    await expectError(async () => {
      await POST(
        `${WF}/WorkflowTasks(ID=${tasks.value[0].ID})/WorkflowService.Approve`,
        { comments: "me too" },
        JOHN,
      );
    }, 403);

    // The reviewer (mgrdept) is also not the configured approver.
    await expectError(async () => {
      await POST(
        `${WF}/WorkflowTasks(ID=${tasks.value[0].ID})/WorkflowService.Approve`,
        { comments: "as reviewer" },
        DMGR,
      );
    }, 403);
  });

  test("workflow approval and business status stay consistent; HR fallback is blocked while running", async () => {
    const review = await createReview();
    await submitReview(review.ID);
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
      { overallRating: "ExceedsExpectations" },
      DMGR,
    );

    // While the workflow instance is Running, the direct HR
    // fallback must refuse (one authority at a time).
    await expectError(async () => {
      await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.ApproveReview`, {}, HR);
    }, 409, /workflow instance is still running/);

    // Normal path: workflow approval moves the review to Approved.
    await approveViaWorkflow(review.ID);
  });

  test("workflow rejection sends the review back to Draft", async () => {
    const review = await createReview();
    await submitReview(review.ID);

    const { data: instances } = await GET(
      `${WF}/WorkflowInstances?$filter=businessObjectId eq ${review.ID}`,
      ADMIN,
    );
    const { data: tasks } = await GET(
      `${WF}/WorkflowTasks?$filter=instance_ID eq ${instances.value[0].ID} and status eq 'Open'`,
      FINMGR,
    );
    await POST(
      `${WF}/WorkflowTasks(ID=${tasks.value[0].ID})/WorkflowService.Reject`,
      { comments: "Rating justification missing." },
      FINMGR,
    );

    const { data } = await GET(`${P}/Reviews(ID=${review.ID})`, HR);
    assert.equal(data.status, "Draft", "rejected workflow returns review to Draft");
  });
});

// ============================================================
// F. RATINGS
// ============================================================
describe("Sprint 13 - F. Ratings", () => {
  test("valid rating accepted on SubmitEvaluation", async () => {
    const review = await createReview();
    await submitReview(review.ID);
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    const res = await POST(
      `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
      { overallRating: "Outstanding" },
      DMGR,
    );
    assert.ok([200, 204].includes(res.status));
  });

  test("invalid rating rejected on SubmitEvaluation", async () => {
    const review = await createReview();
    await submitReview(review.ID);
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.StartReview`, {}, DMGR);
    await expectError(async () => {
      await POST(
        `${P}/Reviews(ID=${review.ID})/PerformanceService.SubmitEvaluation`,
        { overallRating: "11/10 amazing" },
        DMGR,
      );
    }, 400, /Invalid rating/);
  });

  test("overallRating cannot be set via PATCH outside InReview/Submitted", async () => {
    const review = await createReview(); // Draft
    await expectError(async () => {
      await PATCH(`${P}/Reviews(ID=${review.ID})`, { overallRating: "Outstanding" }, HR);
    }, 400, /InReview or Submitted/);
  });

  test("goal rating validated on CompleteGoal", async () => {
    const goal = await createGoal();
    await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.ActivateGoal`, {}, DMGR);
    await expectError(async () => {
      await POST(
        `${P}/Goals(ID=${goal.ID})/PerformanceService.CompleteGoal`,
        { rating: "Superb++" },
        DMGR,
      );
    }, 400, /Invalid rating/);
  });
});

// ============================================================
// G. VALIDATION
// ============================================================
describe("Sprint 13 - G. Validation", () => {
  test("missing employee rejected", async () => {
    await expectError(async () => {
      await POST(`${P}/Reviews`, { reviewer_ID: MGR_EMP_ID, title: "x" }, HR);
    }, 400, /employee is required/);
  });

  test("missing reviewer rejected", async () => {
    await expectError(async () => {
      await POST(`${P}/Reviews`, { employee_ID: JOHN_EMP_ID, title: "x" }, HR);
    }, 400, /reviewer is required/);
  });

  test("non-existent reviewer rejected", async () => {
    await expectError(async () => {
      await createReview({ reviewer_ID: "c0000000-0000-0000-0000-00000000dead" });
    }, 404, /Reviewer not found/);
  });

  test("self-review rejected", async () => {
    await expectError(async () => {
      await createReview({ employee_ID: JOHN_EMP_ID, reviewer_ID: JOHN_EMP_ID });
    }, 400, /cannot review their own/);
  });

  test("invalid dates rejected (period / dueDate / past startDate)", async () => {
    await expectError(async () => {
      await createReview({ periodEnd: "2031-01-01", periodStart: "2031-06-30" });
    }, 400, /periodEnd cannot be before periodStart/);

    await expectError(async () => {
      await createReview({ dueDate: "2030-01-01" });
    }, 400, /dueDate cannot be before/);

    await expectError(async () => {
      await createReview({ startDate: "2020-01-01" });
    }, 400, /startDate cannot be in the past/);
  });

  test("duplicate open review for the same employee/type/period rejected", async () => {
    const period = nextPeriod();
    await createReview({ ...period });
    await expectError(async () => {
      await createReview({ ...period });
    }, 409, /already exists/);
  });

  test("invalid goal weight rejected", async () => {
    await expectError(async () => {
      await createGoal({ weight: 0 });
    }, 400, /weight/);
    await expectError(async () => {
      await createGoal({ weight: 150 });
    }, 400, /weight/);
  });

  test("goal dueDate in the past rejected", async () => {
    await expectError(async () => {
      await createGoal({ dueDate: "2020-01-01" });
    }, 400, /dueDate cannot be in the past/);
  });
});

// ============================================================
// H. AUDIT
// ============================================================
describe("Sprint 13 - H. Audit integration", () => {
  test("lifecycle actions produce audit records", async () => {
    // Drive at least one full review + goal lifecycle first.
    const review = await createReview();
    await submitReview(review.ID);
    await POST(`${P}/Reviews(ID=${review.ID})/PerformanceService.CancelReview`, {}, HR);

    const goal = await createGoal();
    await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.ActivateGoal`, {}, DMGR);

    // AuditLogs are exposed via EmployeeService (SystemAdmin only).
    const { status, data } = await GET(`${AUD}?$filter=entity eq 'Reviews'&$top=50`, ADMIN);
    assert.equal(status, 200);
    assert.ok(data.value.length > 0, "audit rows for Reviews exist");
    assert.ok(
      data.value.some((r) => r.action === "UPDATE" && JSON.stringify(r.newName || r.newName === null ? r.newName : "").includes("PendingReview")),
      "status transitions are audited",
    );

    const goalAudit = await GET(`${AUD}?$filter=entity eq 'Goals'&$top=50`, ADMIN);
    assert.ok(goalAudit.data.value.length > 0, "audit rows for Goals exist");
  });
});

// ============================================================
// I. NOTIFICATIONS
// ============================================================
describe("Sprint 13 - I. Notification integration", () => {
  test("review submission notifies the reviewer", async () => {
    const review = await createReview();
    await submitReview(review.ID);

    const { status, data } = await GET(
      `${NOT}/Notifications?$filter=sourceEntity eq 'PerformanceReview' and sourceRecordId eq ${review.ID}`,
      DMGR, // reviewer = mgrdept -> recipient of the assignment notice
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "reviewer received a review notification");
  });

  test("goal activation notifies the goal owner", async () => {
    const goal = await createGoal(); // owner = empjohn
    await POST(`${P}/Goals(ID=${goal.ID})/PerformanceService.ActivateGoal`, {}, DMGR);

    const { status, data } = await GET(
      `${NOT}/Notifications?$filter=sourceEntity eq 'PerformanceGoal' and sourceRecordId eq ${goal.ID}`,
      JOHN,
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "goal owner received an activation notification");
  });
});

// ============================================================
// J. REGRESSION SMOKE (full regression = npm test)
// ============================================================
describe("Sprint 13 - J. Regression smoke", () => {
  test("recruitment offer service still responds", async () => {
    const res = await GET("/odata/v4/recruitment/Offers?$top=1", ADMIN);
    assert.equal(res.status, 200);
  });

  test("workflow definitions include the new WF-REVIEW-STD", async () => {
    const res = await GET(`${WF}/WorkflowDefinitions`, ADMIN);
    assert.equal(res.status, 200);
    assert.ok(
      res.data.value.some((d) => d.definitionCode === "WF-REVIEW-STD"),
      "performance review workflow definition seeded",
    );
  });
});
