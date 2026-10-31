// ============================================================
// SPRINT 20 - HR SUPPORT / HELPDESK TESTS
// ------------------------------------------------------------
// Covers the Sprint 20 acceptance list:
//
//   * ticket creation, server-stamped requester + validation,
//   * clientRequestId duplicate-safe retries,
//   * anti-bypass guards (direct PATCH/DELETE refused, direct
//     comment creation refused, comment immutability),
//   * the full lifecycle New -> Assigned -> InProgress ->
//     WaitingForEmployee -> Resolved -> Closed (+ invalid ones),
//   * assignment/reassignment with history + idempotent retries,
//   * comments: kind rules, internal-note privacy filter,
//     auto-return to InProgress, firstResponseAt stamping,
//   * requester privacy / cross-employee denial,
//   * reopen with preserved history,
//   * configurable SLA targets + computed OverdueTickets,
//   * notification + audit behavior (dedupe-safe),
//   * regression smoke for Sprint 19 policies.
//
// Same harness as every other suite (test/setup.js).
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { startTestHarness } = require("./setup");
const { GET, POST, PATCH, DELETE } = startTestHarness();

const ADMIN = { auth: { username: "sysadmin", password: "" } };
const HR = { auth: { username: "hrperson", password: "" } };
const JOHN = { auth: { username: "empjohn", password: "" } };
const MGRDEPT = { auth: { username: "mgrdept", password: "" } };

const JOHN_ID = "10000000-0000-0000-0000-000000000001";
const HR_ID = "10000000-0000-0000-0000-000000000002";
const EMP3_ID = "10000000-0000-0000-0000-000000000003"; // dept DEP0002

const HD = "/odata/v4/helpdesk";
const NOTIF = "/odata/v4/notification";
const AUDIT = "/odata/v4/employee";

let ticketSeq = 0;

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
      const text = String(
        err.response?.data?.error?.message ?? err.message ?? "",
      );
      assert.ok(
        text.toLowerCase().includes(messageMatch.toLowerCase()),
        `expected message to contain "${messageMatch}" but was "${text}"`,
      );
    }
  }
}

/**
 * Create a ticket as JOHN (the normal requester flow). The
 * payload deliberately carries a SPOOFED requester_ID to prove
 * the server stamps the real caller.
 */
async function createTicket(actor = JOHN, overrides = {}) {
  ticketSeq += 1;
  const res = await POST(
    `${HD}/HRTickets`,
    {
      requester_ID: HR_ID, // spoof attempt - must be ignored
      category: overrides.category ?? "PayrollQuery",
      subject: overrides.subject ?? `Test ticket ${ticketSeq}`,
      description: overrides.description ?? "Please help me",
      priority: overrides.priority ?? "Medium",
      clientRequestId: overrides.clientRequestId,
      attachedDocument_ID: overrides.attachedDocument_ID,
    },
    actor,
  );
  return res.data;
}

/** Action helper on a bound HRTickets action. */
async function act(ticketId, action, data, actor = HR) {
  return POST(`${HD}/HRTickets(${ticketId})/${action}`, data ?? {}, actor);
}

/** Count SUPPORT notifications for a recipient + ticket.
 * Notifications are recipient-private (recipient_ID =
 * $user.employeeId), so the READ must happen AS the recipient. */
const MOCK_BY_ID = {
  [JOHN_ID]: JOHN,
  [HR_ID]: HR,
};
async function supportNotifCount(recipientId, ticketId) {
  const res = await GET(
    `${NOTIF}/Notifications?$filter=recipient_ID eq '${recipientId}' and sourceRecordId eq '${ticketId}'`,
    MOCK_BY_ID[recipientId] ?? JOHN,
  );
  return res.data.value.length;
}

/**
 * Seed ONE DepartmentHR row for JOHN's department (direct DB,
 * same precedent as the Sprint 19 company seeding): the
 * requester's department then HAS an active HR representative
 * the creation notification can be routed to.
 */
async function seedDepartmentHR() {
  const cdsLocal = require("@sap/cds");
  const DEP1 = "11111111-dddd-1111-dddd-111111111111";
  await cdsLocal.db.run(
    cdsLocal.ql.INSERT.into("ewms.db.organization.DepartmentHR").entries({
      ID: "33333333-hhhh-3333-hhhh-333333333333",
      department_ID: DEP1,
      employee_ID: HR_ID,
      isActive: true,
    }),
  );
}

describe("Sprint 20 - ticket creation & validation", () => {
  test("requester is server-stamped; spoofed payload ignored; code generated", async () => {
    const t = await createTicket(JOHN);
    assert.ok(t.ticketCode && t.ticketCode.startsWith("TCK"), `code: ${t.ticketCode}`);
    const full = await GET(`${HD}/HRTickets/${t.ID}`, JOHN);
    assert.equal(full.data.requester_ID, JOHN_ID);
    assert.equal(full.data.status, "New");
  });

  test("field validation: category/subject/description required, priority checked", async () => {
    await expectError(
      () => POST(`${HD}/HRTickets`, { subject: "x", description: "d" }, JOHN),
      400, "category",
    );
    await expectError(
      () => POST(`${HD}/HRTickets`, { category: "PayrollQuery", description: "d" }, JOHN),
      400, "subject",
    );
    await expectError(
      () => POST(`${HD}/HRTickets`, { category: "PayrollQuery", subject: "s" }, JOHN),
      400, "description",
    );
    await expectError(
      () =>
        POST(
          `${HD}/HRTickets`,
          { category: "PayrollQuery", subject: "s", description: "d", priority: "Blazing" },
          JOHN,
        ),
      400, "priority",
    );
  });

  test("clientRequestId retries never create a second ticket", async () => {
    const token = `req-retry-${Date.now()}`;
    const t1 = await createTicket(JOHN, { clientRequestId: token });
    const firstCode = t1.ticketCode;
    await expectError(
      () => createTicket(JOHN, { clientRequestId: token }),
      409, firstCode,
    );
    const list = await GET(
      `${HD}/HRTickets?$filter=clientRequestId eq '${token}'`,
      HR,
    );
    assert.equal(list.data.value.length, 1);
  });

  test("admin-assisted creation: no-employee users must nominate the requester", async () => {
    await expectError(
      () =>
        POST(
          `${HD}/HRTickets`,
          { category: "GeneralHR", subject: "phone assist", description: "d" },
          ADMIN,
        ),
      403, "nominate",
    );
    const t = await POST(
      `${HD}/HRTickets`,
      {
        category: "GeneralHR",
        subject: "phone assist",
        description: "on behalf of",
        requester_ID: HR_ID,
      },
      ADMIN,
    );
    const full = await GET(`${HD}/HRTickets/${t.data.ID}`, HR);
    assert.equal(full.data.requester_ID, HR_ID);
  });
});

describe("Sprint 20 - anti-bypass guards", () => {
  test("direct PATCH/DELETE on tickets refused (actions are the only workflow)", async () => {
    const t = await createTicket(JOHN);
    await expectError(
      () => PATCH(`${HD}/HRTickets/${t.ID}`, { status: "Resolved" }, HR),
      403,
    );
    await expectError(
      () => PATCH(`${HD}/HRTickets/${t.ID}`, { resolutionNotes: "hacked" }, ADMIN),
      403,
    );
    await expectError(() => DELETE(`${HD}/HRTickets/${t.ID}`, HR), 403);
    const still = await GET(`${HD}/HRTickets/${t.ID}`, HR);
    assert.equal(still.data.status, "New");
  });

  test("comments only via AddComment; records immutable", async () => {
    const t = await createTicket(JOHN);
    // No CREATE grant on comments: the security perimeter itself
    // refuses the direct write (403) before any handler runs.
    await expectError(
      () =>
        POST(`${HD}/HRTicketComments`, { ticket_ID: t.ID, text: "x", kind: "InternalNote" }, ADMIN),
      403,
    );
    // one comment via the action, then prove immutability
    await act(t.ID, "AddComment", { text: "hi", kind: "EmployeeResponse" }, JOHN);
    const list = await GET(
      `${HD}/HRTicketComments?$filter=ticket_ID eq ${t.ID}`,
      HR,
    );
    assert.ok(list.data.value.length >= 1);
    const cid = list.data.value[0].ID;
    await expectError(() => PATCH(`${HD}/HRTicketComments/${cid}`, { text: "tamper" }, HR), 403);
    await expectError(() => DELETE(`${HD}/HRTicketComments/${cid}`, ADMIN), 403);
  });
});

describe("Sprint 20 - lifecycle transitions & invalid ones", () => {
  test("happy path New -> Assigned -> InProgress -> Waiting -> Resolved -> Closed", async () => {
    const t = await createTicket(JOHN);
    const id = t.ID;

    let res = await act(id, "Assign", { agent_ID: HR_ID }, HR);
    assert.ok(String(res.data.value).includes("assigned"));
    let full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "Assigned");
    assert.equal(full.data.assignee_ID, HR_ID);

    res = await act(id, "Start", {}, HR);
    assert.ok(String(res.data.value).includes("InProgress"));
    full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "InProgress");

    res = await act(id, "WaitForEmployee", { reason: "Need payslip copy" }, HR);
    full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "WaitingForEmployee");

    // requester answers -> automatic return to InProgress
    res = await act(id, "AddComment", { text: "here you go", kind: "EmployeeResponse" }, JOHN);
    full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "InProgress");

    // resolution requires notes
    await expectError(() => act(id, "Resolve", {}, HR), 400, "resolutionNotes");
    res = await act(id, "Resolve", { resolutionNotes: "Corrected the record" }, HR);
    full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "Resolved");
    assert.ok(full.data.resolvedOn && full.data.resolutionNotes);

    // requester confirms
    await act(id, "Close", {}, JOHN);
    full = await GET(`${HD}/HRTickets/${id}`, JOHN);
    assert.equal(full.data.status, "Closed");
  });

  test("invalid transitions rejected with 400", async () => {
    const t = await createTicket(JOHN);
    const id = t.ID;

    // Start from New
    await expectError(() => act(id, "Start", {}, HR), 400, "only allowed from");
    // Resolve before working
    await expectError(() => act(id, "Resolve", { resolutionNotes: "x" }, HR), 400, "Cannot resolve");
    // Close before Resolved
    await expectError(() => act(id, "Close", {}, JOHN), 400, "only allowed from");
    // Reopen makes no sense while still open
    await expectError(
      () => act(id, "Reopen", { reason: "x" }, JOHN),
      400, "only allowed for Resolved/Closed",
    );
    // assign to nonexistent employee
    await expectError(
      () => act(id, "Assign", { agent_ID: "99999999-9999-9999-9999-999999999999" }, HR),
      400, "does not exist",
    );

    await act(id, "Assign", { agent_ID: HR_ID }, HR);
    await act(id, "Start", {}, HR);
    await act(id, "Resolve", { resolutionNotes: "done" }, HR);

    // Assign/ChangePriority a resolved ticket
    await expectError(
      () => act(id, "Assign", { agent_ID: EMP3_ID }, HR),
      400, "Cannot assign",
    );
    await expectError(
      () => act(id, "ChangePriority", { priority: "Urgent" }, HR),
      400, "Cannot change priority",
    );
    // second resolve is an invalid transition
    await expectError(
      () => act(id, "Resolve", { resolutionNotes: "again" }, HR),
      400, "Cannot resolve",
    );
    // Reopening a Resolved ticket is VALID (covered by the reopen suite)
  });

  test("only the assigned agent may Start (403 for a different HR actor)", async () => {
    const t = await createTicket(JOHN);
    await act(t.ID, "Assign", { agent_ID: EMP3_ID }, HR);
    // hrperson is an HR agent too but NOT the assigned employee
    await expectError(() => act(t.ID, "Start", {}, HR), 403, "assigned agent");
  });
});

describe("Sprint 20 - assignment history & idempotent actions", () => {
  test("reassignments recorded; same-agent retry is a no-op", async () => {
    const t = await createTicket(JOHN, { category: "LeaveQuestion" });
    const id = t.ID;

    await act(id, "Assign", { agent_ID: HR_ID }, HR);
    // idempotent retry
    const res = await act(id, "Assign", { agent_ID: HR_ID }, HR);
    assert.ok(String(res.data.value).includes("already assigned"));

    await act(id, "Assign", { agent_ID: EMP3_ID }, HR); // reassignment

    const events = await GET(
      `${HD}/HRTicketEvents?$filter=ticket_ID eq ${id}`,
      HR,
    );
    const kinds = events.data.value.map((e) => e.eventType);
    assert.ok(kinds.includes("Created"), `events: ${kinds}`);
    assert.ok(kinds.includes("Assigned"), `events: ${kinds}`);
    assert.ok(kinds.includes("Reassigned"), `events: ${kinds}`);
    const reas = events.data.value.find((e) => e.eventType === "Reassigned");
    assert.equal(reas.toAssignee_ID, EMP3_ID);
    assert.equal(reas.fromAssignee_ID, HR_ID);
  });

  test("event history is HR-only (403 for employees)", async () => {
    const t = await createTicket(JOHN);
    await GET(`${HD}/HRTicketEvents?$filter=ticket_ID eq ${t.ID}`, HR); // ok
    await expectError(() => GET(`${HD}/HRTicketEvents`, JOHN), 403);
  });
});

describe("Sprint 20 - comments & internal-note privacy", () => {
  test("agents may write notes + responses; stamping and kind rules hold", async () => {
    const t = await createTicket(JOHN);
    const id = t.ID;
    await act(id, "Assign", { agent_ID: HR_ID }, HR);

    // internal note by agent
    await act(id, "AddComment", { text: "internal triage memo", kind: "InternalNote" }, HR);
    // first agent response stamps firstResponseAt
    await act(id, "AddComment", { text: "official reply", kind: "AgentResponse" }, HR);
    const full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.ok(full.data.firstResponseAt, "firstResponseAt should be stamped");

    // unknown kind refused
    await expectError(
      () => act(id, "AddComment", { text: "x", kind: "Screaming" }, HR),
      400, "unknown comment kind",
    );
    // employees cannot write agent kinds
    await expectError(
      () => act(id, "AddComment", { text: "spoof", kind: "AgentResponse" }, JOHN),
      403, "agents",
    );
    await expectError(
      () => act(id, "AddComment", { text: "memo", kind: "InternalNote" }, JOHN),
      403, "agents",
    );
  });

  test("requesters never see InternalNote rows or other tickets' comments", async () => {
    const mine = await createTicket(JOHN);
    const theirs = await createTicket(MGRDEPT, { category: "Benefits" });

    await act(mine.ID, "AddComment", { text: "private memo", kind: "InternalNote" }, HR);
    await act(mine.ID, "AddComment", { text: "official answer", kind: "AgentResponse" }, HR);
    await act(theirs.ID, "AddComment", { text: "other conversation", kind: "AgentResponse" }, HR);

    // JOHN's read: own ticket's visible comments ONLY
    const mineList = await GET(
      `${HD}/HRTicketComments?$filter=ticket_ID eq ${mine.ID}`,
      JOHN,
    );
    const kindsSeen = mineList.data.value.map((c) => c.kind);
    assert.ok(!kindsSeen.includes("InternalNote"), `leaked kinds: ${kindsSeen}`);
    assert.ok(kindsSeen.includes("AgentResponse"), `missing official reply: ${kindsSeen}`);

    // other ticket's comments must NOT be readable at all
    const otherList = await GET(
      `${HD}/HRTicketComments?$filter=ticket_ID eq ${theirs.ID}`,
      JOHN,
    );
    assert.equal(otherList.data.value.length, 0);

    // HR sees everything
    const hrList = await GET(
      `${HD}/HRTicketComments?$filter=ticket_ID eq ${mine.ID}`,
      HR,
    );
    assert.ok(hrList.data.value.some((c) => c.kind === "InternalNote"));
  });

  test("WaitingForEmployee + employee response auto-returns to InProgress and notifies", async () => {
    const t = await createTicket(JOHN);
    const id = t.ID;
    await act(id, "Assign", { agent_ID: HR_ID }, HR);
    await act(id, "WaitForEmployee", { reason: "Please confirm dates" }, HR);

    const before = await supportNotifCount(HR_ID, id);
    await act(id, "AddComment", { text: "dates confirmed", kind: "EmployeeResponse" }, JOHN);
    const after = await supportNotifCount(HR_ID, id);

    const full = await GET(`${HD}/HRTickets/${id}`, HR);
    assert.equal(full.data.status, "InProgress");
    assert.ok(after > before, `assignee should hear about the reply (${before} -> ${after})`);
  });
});

describe("Sprint 20 - requester privacy / cross-employee denial", () => {
  test("JOHN sees own tickets; not others' tickets (neither list nor by ID)", async () => {
    const mine = await createTicket(JOHN);
    const theirs = await createTicket(MGRDEPT, { category: "PolicyClarification" });

    const mineList = await GET(`${HD}/HRTickets`, JOHN);
    assert.ok(mineList.data.value.some((t) => t.ID === mine.ID));
    assert.ok(!mineList.data.value.some((t) => t.ID === theirs.ID), "leak: other requester visible");

    await expectError(() => GET(`${HD}/HRTickets/${theirs.ID}`, JOHN), 404);

    // employees are not agents: no actions granted
    await expectError(
      () => act(theirs.ID, "Assign", { agent_ID: HR_ID }, JOHN),
      403,
    );

    // HR sees all
    const hrList = await GET(`${HD}/HRTickets`, HR);
    assert.ok(hrList.data.value.some((t) => t.ID === theirs.ID));
  });
});

describe("Sprint 20 - reopen & history preservation", () => {
  test("reopened ticket keeps its full event trail; reason required; invalid reopen refused", async () => {
    const t = await createTicket(JOHN);
    const id = t.ID;
    await act(id, "Assign", { agent_ID: HR_ID }, HR);
    await act(id, "Resolve", { resolutionNotes: "first try" }, HR);

    await expectError(() => act(id, "Reopen", {}, JOHN), 400, "reason");
    await expectError(() => act(id, "Reopen", { reason: "why not" }, MGRDEPT), 403, "requester or HR");

    const res = await act(id, "Reopen", { reason: "Problem persists" }, JOHN);
    assert.ok(String(res.data.value).includes("reopened"));
    const full = await GET(`${HD}/HRTickets/${id}`, JOHN);
    assert.equal(full.data.status, "InProgress"); // assignee kept
    assert.ok(full.data.resolvedOn == null && full.data.resolutionNotes == null);

    // History: Created + Assigned + StatusChange(Resolved) + Reopened
    const events = await GET(`${HD}/HRTicketEvents?$filter=ticket_ID eq ${id}`, HR);
    const kinds = events.data.value.map((e) => e.eventType);
    assert.ok(kinds.includes("Created") && kinds.includes("Assigned") && kinds.includes("Reopened"),
      `history: ${kinds}`);
    const reopened = events.data.value.find((e) => e.eventType === "Reopened");
    assert.equal(reopened.fromStatus, "Resolved");
    assert.equal(reopened.toStatus, "InProgress");
    assert.ok(String(reopened.reason).includes("Problem persists"));

    // and the reopened ticket can flow again to Closed
    await act(id, "Resolve", { resolutionNotes: "second try" }, HR);
    await act(id, "Close", {}, JOHN);
    const closed = await GET(`${HD}/HRTickets/${id}`, JOHN);
    assert.equal(closed.data.status, "Closed");
  });
});

describe("Sprint 20 - SLA configuration & computed overdue reporting", () => {
  test("SLA config is HR-maintained (employee writes refused); targets stored as configured", async () => {
    await POST(`${HD}/HRTicketSLAConfigs`, {
      category: "PayrollQuery",
      responseTargetHours: 4,
      resolutionTargetHours: 48,
      active: true,
    }, HR);
    await expectError(
      () => POST(`${HD}/HRTicketSLAConfigs`, { category: "LeaveQuestion", responseTargetHours: 9 }, JOHN),
      403,
    );
    const cfg = await GET(`${HD}/HRTicketSLAConfigs?$filter=category eq 'PayrollQuery'`, HR);
    assert.equal(cfg.data.value[0].responseTargetHours, 4);
  });

  test("overdue view is computed (firstResponseAt = measured input, never claimed automatic)", async () => {
    // Seed: push a fresh in-progress ticket into the past via the
    // shared test DB (same direct-DB precedent as Sprint 19).
    const cdsLocal = require("@sap/cds");
    const t = await createTicket(JOHN, { category: "PayrollQuery" });
    const id = t.ID;
    await act(id, "Assign", { agent_ID: HR_ID }, HR);
    const past = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    await cdsLocal.db.run(
      cdsLocal.ql.UPDATE("ewms.db.helpdesk.HRTicket", id).set({ createdAt: past }),
    );

    // response target 4h exceeded (no AgentResponse yet), resolution 48h not yet
    const overdue = await GET(`${HD}/OverdueTickets`, HR);
    const row = overdue.data.value.find((r) => r.ticket_ID === id);
    assert.ok(row, "expected an overdue row for the seeded ticket");
    assert.equal(row.overdueType, "Response");
    // 5h ago created - 4h response target = ~1h overdue
    assert.ok(row.hoursOverdue >= 1 && row.hoursOverdue <= 6, `hoursOverdue: ${row.hoursOverdue}`);

    // The agent answers -> response overdue disappears; resolution
    // target (48h from creation) is still in the future.
    await act(id, "AddComment", { text: "answer", kind: "AgentResponse" }, HR);
    const after2 = await GET(`${HD}/OverdueTickets`, HR);
    assert.ok(!after2.data.value.some((r) => r.ticket_ID === id),
      "no overdue when within targets and answered");

    // Tickets without any configured category can NEVER be overdue.
    const t2 = await createTicket(JOHN, { category: "GeneralHR" });
    const past2 = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    await cdsLocal.db.run(
      cdsLocal.ql.UPDATE("ewms.db.helpdesk.HRTicket", t2.ID).set({ createdAt: past2 }),
    );
    const after3 = await GET(
      `${HD}/OverdueTickets?$filter=ticket_ID eq ${t2.ID}`,
      HR,
    );
    assert.equal(after3.data.value.length, 0, "no config = no overdue");

    // resolved tickets are simply gone from the open set
    await act(id, "Resolve", { resolutionNotes: "handled finally" }, HR);
    const after4 = await GET(`${HD}/OverdueTickets?$filter=ticket_ID eq ${id}`, HR);
    assert.equal(after4.data.value.length, 0);
  });

  test("overdue reporting is HR-only (requester denied)", async () => {
    await expectError(() => GET(`${HD}/OverdueTickets`, JOHN), 403);
  });
});

describe("Sprint 20 - notifications & audit", () => {
  test("SUPPORT notifications for creation (department HR) and assignment; idempotent retries add none", async () => {
    await seedDepartmentHR();

    const t = await createTicket(JOHN);
    await act(t.ID, "Assign", { agent_ID: HR_ID }, HR);

    // requester got the assignment notification; dept-HR got creation
    const john = await GET(
      `${NOTIF}/Notifications?$filter=recipient_ID eq '${JOHN_ID}' and sourceRecordId eq '${t.ID}'`,
      JOHN,
    );
    assert.ok(john.data.value.some((n) => n.category === "SUPPORT"), "assignment notification missing");

    const hrBefore = await supportNotifCount(HR_ID, t.ID);
    // idempotent re-assign adds NO notification
    await act(t.ID, "Assign", { agent_ID: HR_ID }, HR);
    const hrAfter = await supportNotifCount(HR_ID, t.ID);
    assert.equal(hrAfter, hrBefore, "retry must not duplicate notifications");
  });

  test("lifecycle transitions are audited (HRTicket rows visible to SystemAdmin)", async () => {
    const t = await createTicket(JOHN);
    await act(t.ID, "Assign", { agent_ID: HR_ID }, HR);
    await act(t.ID, "Reopen", { reason: "audit probe" }, MGRDEPT)
      .catch(() => {}); // invalid on purpose - only the audit of real actions is asserted

    await act(t.ID, "Resolve", { resolutionNotes: "audit close-out" }, HR);

    const res = await GET(
      `${AUDIT}/AuditLogs?$filter=entity eq 'HRTicket' and action eq 'Assign'&$top=1`,
      ADMIN,
    );
    assert.ok(res.data.value.length >= 1, "Assign must be audited");
    const reo = await GET(
      `${AUDIT}/AuditLogs?$filter=entity eq 'HRTicket' and action eq 'Resolve'&$top=1`,
      ADMIN,
    );
    assert.ok(reo.data.value.length >= 1, "Resolve must be audited");
  });
});

describe("Sprint 20 - regression smoke (Sprint 17/18/19 endpoints alive)", () => {
  test("policy, engagement and document surfaces still serve", async () => {
    const pol = await GET("/odata/v4/hrpolicy/Policies", JOHN);
    assert.equal(pol.status, 200);
    const eng = await GET("/odata/v4/engagement/EngagementSurveys", HR);
    assert.equal(eng.status, 200);
    const cmp = await GET("/odata/v4/compliance/DocumentRequirements", HR);
    assert.equal(cmp.status, 200);
  });
});
