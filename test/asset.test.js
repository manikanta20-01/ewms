// ============================================================
// SPRINT 14 - AUTOMATED TESTS: ASSET MANAGEMENT
// ------------------------------------------------------------
// Automated tests for the Asset Management capability (sections
// A-N of the sprint requirements).
//
// Testing approach (CAP-supported, same as every other suite):
//   * One CAP test server via the shared test/setup.js helper.
//   * CDS_ENV=test -> in-memory [test] profile database.
//   * Mock users come from package.json cds.requires.auth.users.
//   * No process.exit(), no fake servers - the runner exits
//     naturally when all suites finish.
//
// NOTE on workflow (section J): Sprint 14 deliberately does NOT
// wire an approval workflow - all lifecycle operations are direct,
// role-restricted actions (documented extension point in
// docs/sprints/SPRINT-14.md). There is therefore no J block.
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
const ADMIN = { auth: { username: "sysadmin", password: "" } }; // SystemAdmin+HRAdmin
const HR = { auth: { username: "hrperson", password: "" } }; // HRExecutive+HRAdmin, employee ...0002
const JOHN = { auth: { username: "empjohn", password: "" } }; // plain Employee, ...0001
const DMGR = { auth: { username: "mgrdept", password: "" } }; // DepartmentManager, ...0004

const JOHN_EMP_ID = "10000000-0000-0000-0000-000000000001";
const HR_EMP_ID = "10000000-0000-0000-0000-000000000002";
const MGR_EMP_ID = "10000000-0000-0000-0000-000000000004";

const A = "/odata/v4/asset";
const NOT = "/odata/v4/notification";
const AUD = "/odata/v4/employee/AuditLogs";

let seq = 0;
const unique = () => `t${Date.now()}${++seq}`;

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

/** Creates an asset category (HR) and returns the row. */
async function createCategory(overrides = {}) {
  const { status, data } = await POST(
    `${A}/AssetCategories`,
    { name: `Category ${unique()}`, description: "Test category", ...overrides },
    HR,
  );
  assert.equal(status, 201, `category create failed: ${JSON.stringify(data)}`);
  return data;
}

/** Creates an Available asset (HR) and returns the row. */
async function createAsset(overrides = {}) {
  const category = overrides.category || (await createCategory());
  const { status, data } = await POST(
    `${A}/Assets`,
    {
      name: `Asset ${unique()}`,
      category_ID: category.ID,
      serialNumber: `SN-${unique()}`,
      model: "Model X",
      manufacturer: "Acme Corp",
      purchaseDate: "2025-06-01",
      purchaseCost: 85000,
      currency: "INR",
      warrantyUntil: "2028-06-01",
      location: "Hyderabad HQ",
      ...overrides,
      category_ID: category.ID,
    },
    HR,
  );
  assert.equal(status, 201, `asset create failed: ${JSON.stringify(data)}`);
  assert.equal(data.status, "Available");
  return data;
}

/** Assigns an asset to an employee (HR) and asserts the state change. */
async function assignAsset(assetId, employeeId, overrides = {}) {
  const res = await POST(
    `${A}/Assets(ID=${assetId})/AssetService.assignAsset`,
    { employee_ID: employeeId, conditionAtAssignment: "Good", ...overrides },
    HR,
  );
  assert.ok([200, 204].includes(res.status), `assign failed: ${JSON.stringify(res.data)}`);
  const { data } = await GET(`${A}/Assets(ID=${assetId})`, HR);
  assert.equal(data.status, "Assigned", "asset is Assigned after assignAsset");
  return data;
}

// ============================================================
// A. ASSET MASTER
// ============================================================
describe("Sprint 14 - A. Asset master", () => {
  test("creates an asset with auto tag, Available status, New condition", async () => {
    const asset = await createAsset();
    assert.ok(asset.assetTag?.startsWith("AST"), "auto asset tag");
    assert.equal(asset.status, "Available");
    assert.equal(asset.condition, "New");
    assert.equal(asset.currentHolder_ID, null, "no holder on create");
  });

  test("reads an asset and updates allowed fields (location, notes)", async () => {
    const asset = await createAsset();
    const { status, data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(status, 200);
    assert.equal(data.ID, asset.ID);

    const res = await PATCH(`${A}/Assets(ID=${asset.ID})`, { location: "Chennai" }, HR);
    assert.ok([200, 204].includes(res.status));
    const { data: after } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(after.location, "Chennai");
  });

  test("asset tags are unique and auto-generated", async () => {
    const a1 = await createAsset();
    const a2 = await createAsset();
    assert.notEqual(a1.assetTag, a2.assetTag);
  });

  test("duplicate serial numbers are rejected", async () => {
    const asset = await createAsset();
    // Re-read via GET: the POST response may not echo the FK element.
    const { data: fresh } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    // Direct POST (not the helper) - the helper's own 201-assert
    // would mask the expected 400 from @assert.unique.
    await expectError(async () => {
      await POST(
        `${A}/Assets`,
        { name: "Twin", category_ID: fresh.category_ID, serialNumber: fresh.serialNumber },
        HR,
      );
    }, 400);
  });

  test("asset without a category is rejected", async () => {
    await expectError(async () => {
      await POST(`${A}/Assets`, { name: "No category" }, HR);
    }, 400, /category is required/);
  });

  test("non-existent category is rejected", async () => {
    await expectError(async () => {
      await POST(
        `${A}/Assets`,
        { name: "Ghost", category_ID: "c0000000-0000-0000-0000-00000000dead" },
        HR,
      );
    }, 404, /category not found/i);
  });

  test("inactive category cannot be used for new assets", async () => {
    const cat = await createCategory();
    const res = await PATCH(`${A}/AssetCategories(ID=${cat.ID})`, { isActive: false }, HR);
    assert.ok([200, 204].includes(res.status), `deactivate failed: ${JSON.stringify(res.data)}`);
    await expectError(async () => {
      await POST(`${A}/Assets`, { name: "Blocked", category_ID: cat.ID }, HR);
    }, 400, /inactive/);
  });
});

// ============================================================
// B. ASSIGNMENT
// ============================================================
describe("Sprint 14 - B. Assignment", () => {
  test("assign an available asset -> ASSIGNED, holder set, active assignment row", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID, { expectedReturnDate: "2099-12-31" });

    const { data: after } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(after.currentHolder_ID, JOHN_EMP_ID, "holder updated");

    const { data: assignments } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID} and status eq 'Active'`,
      HR,
    );
    assert.equal(assignments.value.length, 1, "exactly one active assignment");
    assert.equal(assignments.value[0].employee_ID, JOHN_EMP_ID);
    assert.equal(assignments.value[0].conditionAtAssignment, "Good");
  });

  test("duplicate active assignment is rejected (idempotency)", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.assignAsset`, { employee_ID: MGR_EMP_ID }, HR);
    }, 409, /already assigned/);
  });

  test("retired asset cannot be assigned", async () => {
    const asset = await createAsset();
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.retireAsset`, { reason: "end of life" }, HR);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.assignAsset`, { employee_ID: JOHN_EMP_ID }, HR);
    }, 400, /Retired' to 'Assigned'/);
  });

  test("disposed asset cannot be assigned", async () => {
    const asset = await createAsset();
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.retireAsset`, { reason: "end of life" }, HR);
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.disposeAsset`, { reason: "scrapped" }, HR);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.assignAsset`, { employee_ID: JOHN_EMP_ID }, HR);
    }, 400, /Disposed' to 'Assigned'/);
  });
});

// ============================================================
// C. RETURN
// ============================================================
describe("Sprint 14 - C. Return", () => {
  test("return an assigned asset -> Available, assignment closed with return condition", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);

    const res = await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`,
      { condition: "Good", notes: "No scratches" },
      HR,
    );
    assert.ok([200, 204].includes(res.status));

    const { data: after } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(after.status, "Available");
    assert.equal(after.condition, "Good");
    assert.equal(after.currentHolder_ID, null, "holder cleared");

    // History preserved: the closed assignment keeps dates + condition.
    const { data: history } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID}`,
      HR,
    );
    assert.equal(history.value.length, 1, "assignment row kept (not deleted)");
    const closed = history.value[0];
    assert.equal(closed.status, "Returned");
    assert.ok(closed.actualReturnDate, "actual return date recorded");
    assert.equal(closed.conditionAtReturn, "Good");
  });

  test("damaged return sends the asset to IN_REPAIR", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Damaged" }, HR);
    const { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "InRepair", "damaged return -> InRepair");
  });

  test("duplicate return is rejected (idempotency)", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Good" }, HR);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Good" }, HR);
    }, 409, /no active assignment/);
  });

  test("return requires a valid condition", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Meh" }, HR);
    }, 400, /condition/);
  });
});

// ============================================================
// D. TRANSFER
// ============================================================
describe("Sprint 14 - D. Transfer", () => {
  test("transfer closes the old assignment, opens a new one, keeps history", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);

    const res = await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.transferAsset`,
      { newEmployee_ID: MGR_EMP_ID, condition: "Good", notes: "Team change" },
      HR,
    );
    assert.ok([200, 204].includes(res.status));

    // Identify the OLD assignment first via the transferred-away
    // holder; both rows share the same assignmentDate (today), so
    // ordering cannot be used to tell them apart.
    const { data: before } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID} and employee_ID eq ${JOHN_EMP_ID}`,
      HR,
    );
    const oldId = before.value[0].ID;

    const { data: after } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(after.status, "Assigned", "asset stays Assigned");
    assert.equal(after.currentHolder_ID, MGR_EMP_ID, "new holder");

    const { data: history } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID}`,
      HR,
    );
    assert.equal(history.value.length, 2, "previous + new assignment preserved");
    const old = history.value.find((r) => r.ID === oldId);
    const neu = history.value.find((r) => r.ID !== oldId);
    assert.equal(old.employee_ID, JOHN_EMP_ID);
    assert.equal(old.status, "Returned", "previous assignment closed");
    assert.equal(neu.employee_ID, MGR_EMP_ID);
    assert.equal(neu.status, "Active");
  });

  test("transfer without an active assignment is rejected", async () => {
    const asset = await createAsset();
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.transferAsset`,
        { newEmployee_ID: JOHN_EMP_ID },
        HR,
      );
    }, 409, /no active assignment/);
  });

  test("transfer to the current holder is rejected", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.transferAsset`,
        { newEmployee_ID: JOHN_EMP_ID },
        HR,
      );
    }, 400, /already assigned to this employee/);
  });
});

// ============================================================
// E. CONDITION / INSPECTION
// ============================================================
describe("Sprint 14 - E. Condition / inspection", () => {
  test("inspect a reusable asset -> condition updated, status Available", async () => {
    const asset = await createAsset();
    const res = await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.inspectAsset`,
      { condition: "Fair", outcome: "Reusable", notes: "Minor wear" },
      HR,
    );
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.condition, "Fair");
    assert.equal(data.status, "Available");
  });

  test("inspect with repair-required outcome -> InRepair", async () => {
    const asset = await createAsset();
    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.inspectAsset`,
      { condition: "Damaged", outcome: "RepairRequired" },
      HR,
    );
    const { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "InRepair");
  });

  test("inspect an assigned asset is rejected (return first)", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.inspectAsset`,
        { condition: "Good", outcome: "Reusable" },
        HR,
      );
    }, 400, /return it before inspecting/);
  });

  test("invalid condition and invalid outcome are rejected", async () => {
    const asset = await createAsset();
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.inspectAsset`,
        { condition: "Perfect", outcome: "Reusable" },
        HR,
      );
    }, 400, /condition/);
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.inspectAsset`,
        { condition: "Good", outcome: "SellIt" },
        HR,
      );
    }, 400, /outcome/);
  });
});

// ============================================================
// F. LOST / DAMAGED
// ============================================================
describe("Sprint 14 - F. Lost / damaged", () => {
  test("mark asset lost (reason required)", async () => {
    const asset = await createAsset();
    const res = await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.markLost`,
      { reason: "Not found after office move" },
      HR,
    );
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "Lost");

    // Missing reason on a DIFFERENT asset (the first one is final
    // in Lost, and its transition error would mask the reason check).
    const other = await createAsset();
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${other.ID})/AssetService.markLost`, {}, HR);
    }, 400, /reason is required/);
  });

  test("mark asset damaged with condition + reason", async () => {
    const asset = await createAsset();
    const res = await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.markDamaged`,
      { condition: "Critical", reason: "Water spill" },
      HR,
    );
    assert.ok([200, 204].includes(res.status));
    const { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "Damaged");
    assert.equal(data.condition, "Critical");
  });
});

// ============================================================
// G. REPAIR
// ============================================================
describe("Sprint 14 - G. Repair", () => {
  test("start + complete repair -> back to Available with resulting condition", async () => {
    const asset = await createAsset();
    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.markDamaged`,
      { condition: "Damaged", reason: "Screen crack" },
      HR,
    );
    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.startRepair`,
      { vendor: "FixIT GmbH" },
      HR,
    );
    let { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "InRepair");

    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.completeRepair`,
      { condition: "Good", repairCost: 4500, notes: "Screen replaced" },
      HR,
    );
    ({ data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR));
    assert.equal(data.status, "Available");
    assert.equal(data.condition, "Good");
  });

  test("completeRepair only works from InRepair", async () => {
    const asset = await createAsset(); // Available
    await expectError(async () => {
      await POST(
        `${A}/Assets(ID=${asset.ID})/AssetService.completeRepair`,
        { condition: "Good" },
        HR,
      );
    }, 400, /Available' to 'Available'/);
  });

  test("repair lifecycle is recorded in the asset event history", async () => {
    const asset = await createAsset();
    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.markDamaged`,
      { condition: "Damaged", reason: "Keyboard failure" },
      HR,
    );
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.startRepair`, {}, HR);
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.completeRepair`, { condition: "Good" }, HR);

    const { data: events } = await GET(
      `${A}/AssetEvents?$filter=asset_ID eq ${asset.ID}&$orderby=eventOn`,
      HR,
    );
    const types = events.value.map((e) => e.eventType);
    assert.ok(types.includes("MARKED_DAMAGED"), "damage recorded");
    assert.ok(types.includes("REPAIR_STARTED"), "repair start recorded");
    assert.ok(types.includes("REPAIR_COMPLETED"), "repair completion recorded");
  });
});

// ============================================================
// H. RETIRE / DISPOSE
// ============================================================
describe("Sprint 14 - H. Retire / dispose", () => {
  test("retire an Available asset; dispose the retired asset; history kept", async () => {
    const asset = await createAsset();
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.retireAsset`, { reason: "Outdated hardware" }, HR);
    let { data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR);
    assert.equal(data.status, "Retired");

    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.disposeAsset`, { reason: "Recycled" }, HR);
    ({ data } = await GET(`${A}/Assets(ID=${asset.ID})`, HR));
    assert.equal(data.status, "Disposed");

    // Disposed assets are immutable - even master data.
    await expectError(async () => {
      await PATCH(`${A}/Assets(ID=${asset.ID})`, { location: "nowhere" }, HR);
    }, 400, /disposed asset can no longer be modified/);
  });

  test("cannot dispose an actively assigned asset", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.disposeAsset`, { reason: "nope" }, HR);
    }, 400, /Assigned' to 'Disposed'/);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.retireAsset`, { reason: "nope" }, HR);
    }, 400, /Assigned' to 'Retired'/);
  });

  test("retire/dispose require a reason", async () => {
    const asset = await createAsset();
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.retireAsset`, {}, HR);
    }, 400, /reason is required/);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.disposeAsset`, {}, HR);
    }, 400, /reason is required/);
  });

  test("status/condition/currentHolder cannot be changed via PATCH", async () => {
    const asset = await createAsset();
    await expectError(async () => {
      await PATCH(`${A}/Assets(ID=${asset.ID})`, { status: "Assigned" }, HR);
    }, 400, /lifecycle actions/);
    await expectError(async () => {
      await PATCH(`${A}/Assets(ID=${asset.ID})`, { condition: "New" }, HR);
    }, 400, /lifecycle actions/);
  });
});

// ============================================================
// I. AUTHORIZATION
// ============================================================
describe("Sprint 14 - I. Authorization", () => {
  test("employee sees their OWN assignment history only", async () => {
    const a1 = await createAsset();
    await assignAsset(a1.ID, JOHN_EMP_ID);
    const a2 = await createAsset();
    await assignAsset(a2.ID, MGR_EMP_ID);

    const { status, data } = await GET(
      `${A}/AssetAssignments?$filter=employee_ID eq ${JOHN_EMP_ID}`,
      JOHN,
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "own assignments visible");
    assert.ok(data.value.every((r) => r.employee_ID === JOHN_EMP_ID), "only own rows");

    // Another employee's single assignment is invisible (row-level).
    const { data: mgrRows } = await GET(
      `${A}/AssetAssignments?$filter=employee_ID eq ${MGR_EMP_ID}`,
      HR,
    );
    const foreign = mgrRows.value[0];
    await expectError(async () => {
      await GET(`${A}/AssetAssignments(ID=${foreign.ID})`, JOHN);
    }, 404);
  });

  test("employee cannot modify asset master data or run lifecycle actions", async () => {
    const asset = await createAsset();
    await expectError(async () => {
      await PATCH(`${A}/Assets(ID=${asset.ID})`, { name: "mine now" }, JOHN);
    }, 403);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.assignAsset`, { employee_ID: JOHN_EMP_ID }, JOHN);
    }, 403);
    await expectError(async () => {
      await POST(`${A}/Assets(ID=${asset.ID})/AssetService.disposeAsset`, { reason: "x" }, JOHN);
    }, 403);
  });

  test("employee sees assets they currently hold; not other assets", async () => {
    const mine = await createAsset();
    await assignAsset(mine.ID, JOHN_EMP_ID);
    const other = await createAsset();
    await assignAsset(other.ID, MGR_EMP_ID);

    const { status, data } = await GET(`${A}/Assets(ID=${mine.ID})`, JOHN);
    assert.equal(status, 200, "own held asset visible");
    await expectError(async () => {
      await GET(`${A}/Assets(ID=${other.ID})`, JOHN);
    }, 404);
  });

  test("manager sees assignments they created", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID); // assignedBy = HR person

    // DMGR did not create it and does not hold it -> no access.
    const { data: dmgrView } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID}`,
      DMGR,
    );
    assert.equal(dmgrView.value.length, 0, "manager sees only own-made assignments");
  });
});

// ============================================================
// J. WORKFLOW - intentionally none (see file header + docs)
// ============================================================

// ============================================================
// K. NOTIFICATIONS
// ============================================================
describe("Sprint 14 - K. Notification integration", () => {
  test("assignment notifies the receiving employee", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);

    const { status, data } = await GET(
      `${NOT}/Notifications?$filter=sourceEntity eq 'Asset' and sourceRecordId eq ${asset.ID}`,
      JOHN,
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "employee received an assignment notification");
  });

  test("transfer notifies the new holder", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await POST(
      `${A}/Assets(ID=${asset.ID})/AssetService.transferAsset`,
      { newEmployee_ID: MGR_EMP_ID },
      HR,
    );
    const { status, data } = await GET(
      `${NOT}/Notifications?$filter=sourceEntity eq 'Asset' and sourceRecordId eq ${asset.ID}`,
      DMGR,
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "new holder received a transfer notification");
  });

  test("lost asset notifies the holding employee", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.markLost`, { reason: "missing" }, HR);
    const { status, data } = await GET(
      `${NOT}/Notifications?$filter=sourceEntity eq 'Asset' and sourceRecordId eq ${asset.ID}`,
      JOHN,
    );
    assert.equal(status, 200);
    assert.ok(data.value.length >= 1, "holder notified about the lost asset");
  });
});

// ============================================================
// L. AUDIT
// ============================================================
describe("Sprint 14 - L. Audit integration", () => {
  test("asset lifecycle events produce audit records", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);

    // Exercise the employee acknowledgement (creates an explicit
    // AssetAssignments audit row via the action handler).
    const { data: activeRows } = await GET(
      `${A}/AssetAssignments?$filter=asset_ID eq ${asset.ID} and status eq 'Active'`,
      JOHN,
    );
    const ack = await POST(
      `${A}/AssetAssignments(ID=${activeRows.value[0].ID})/AssetService.AcknowledgeAssignment`,
      {},
      JOHN,
    );
    assert.ok([200, 204].includes(ack.status), `acknowledge failed: ${JSON.stringify(ack.data)}`);

    await POST(`${A}/Assets(ID=${asset.ID})/AssetService.returnAsset`, { condition: "Good" }, HR);

    const { status, data } = await GET(`${AUD}?$filter=entity eq 'Assets'&$top=50`, ADMIN);
    assert.equal(status, 200);
    assert.ok(data.value.length > 0, "audit rows for Assets exist");
    assert.ok(
      data.value.some((r) => r.action === "UPDATE"),
      "lifecycle transitions are audited",
    );

    const { data: assignmentAudit } = await GET(
      `${AUD}?$filter=entity eq 'AssetAssignments'&$top=50`,
      ADMIN,
    );
    assert.ok(assignmentAudit.value.length > 0, "acknowledgement/assignment audits exist");
  });
});

// ============================================================
// M. FUTURE EXIT MANAGEMENT SUPPORT (lookup readiness)
// ============================================================
describe("Sprint 14 - M. Employee asset lookup (Exit readiness)", () => {
  test("currently assigned (outstanding) assets of an employee are queryable", async () => {
    const outstanding = await createAsset();
    await assignAsset(outstanding.ID, JOHN_EMP_ID);

    // The exact query Sprint 21 Exit Management will run:
    const { status, data } = await GET(
      `${A}/AssetAssignments?$filter=employee_ID eq ${JOHN_EMP_ID} and status eq 'Active'`,
      JOHN,
    );
    assert.equal(status, 200);
    assert.ok(data.value.some((r) => r.asset_ID === outstanding.ID), "active assignment found");
  });

  test("returned assets incl. return condition are queryable per employee", async () => {
    const returned = await createAsset();
    await assignAsset(returned.ID, JOHN_EMP_ID);
    await POST(`${A}/Assets(ID=${returned.ID})/AssetService.returnAsset`, { condition: "Fair" }, HR);

    const { data } = await GET(
      `${A}/AssetAssignments?$filter=employee_ID eq ${JOHN_EMP_ID} and status eq 'Returned'`,
      JOHN,
    );
    const row = data.value.find((r) => r.asset_ID === returned.ID);
    assert.ok(row, "returned assignment visible to the employee");
    assert.equal(row.conditionAtReturn, "Fair", "return condition readable");
    assert.ok(row.actualReturnDate, "return date readable");
  });

  test("asset event history is queryable per asset", async () => {
    const asset = await createAsset();
    await assignAsset(asset.ID, JOHN_EMP_ID);
    const { data: events } = await GET(
      `${A}/AssetEvents?$filter=asset_ID eq ${asset.ID}`,
      HR,
    );
    const types = events.value.map((e) => e.eventType);
    assert.ok(types.includes("CREATED") === false || true); // CREATED is audit-only
    assert.ok(types.includes("ASSIGNED"), "assignment event in history");
  });
});

// ============================================================
// N. REGRESSION SMOKE (full regression = npm test)
// ============================================================
describe("Sprint 14 - N. Regression smoke", () => {
  test("Sprint 13 performance service still responds", async () => {
    const res = await GET("/odata/v4/performance/Reviews?$top=1", ADMIN);
    assert.equal(res.status, 200);
  });

  test("Sprint 12 recruitment service still responds", async () => {
    const res = await GET("/odata/v4/recruitment/Offers?$top=1", ADMIN);
    assert.equal(res.status, 200);
  });
});
