// ============================================================
// SPRINT 17 - DOCUMENTS & COMPLIANCE TESTS
// ------------------------------------------------------------
// Covers the Sprint 17 acceptance list (B8):
//
//   * metadata validation, allowed/forbidden content types, size,
//   * secure upload + download (base64 round-trip; the storage key
//     is never exposed and path traversal is refused),
//   * employee self-access / cross-employee denial / manager scope,
//   * verify / reject / archive lifecycle + protected PATCHes,
//   * requirement configuration (admin-only CRUD),
//   * compliance computation: missing / pending / rejected /
//     expired / expiring / compliant + mandatory-only status,
//   * duplicate uploads and safe retries,
//   * expiry reminder action with dedupe (no phantom scheduler),
//   * audit rows for verification decisions.
//
// Same harness as every other suite (test/setup.js, in-memory DB).
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

const EMP = "/odata/v4/employee";
const COMP = "/odata/v4/compliance";
const NOTIF = "/odata/v4/notification";

const REQ_PAN = "40000000-0000-0000-0000-000000000001"; // mandatory, requiresIssueDate
const REQ_PASSPORT = "40000000-0000-0000-0000-000000000002"; // optional
const REQ_DEGREE = "40000000-0000-0000-0000-000000000003"; // mandatory, Permanent
const REQ_CONTRACT = "40000000-0000-0000-0000-000000000004"; // mandatory
const REQ_MEDICAL = "40000000-0000-0000-0000-000000000005"; // mandatory, alert 180

const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex"); // real PNG magic
const b64 = (buf) => buf.toString("base64");
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

/** Upload a document for JOHN (or targets override) and return the row. */
async function upload(payload, headers = JOHN) {
  const res = await POST(`${EMP}/Documents`, payload, headers);
  return res;
}

async function verifyDoc(ID, headers = HR, comments = "Looks genuine") {
  return POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Verify`, { comments }, headers);
}

async function lineFor(employeeId, reqId, headers) {
  const { data } = await GET(
    `${COMP}/ComplianceLines?$filter=employee_ID eq ${employeeId}`,
    headers,
  );
  return data.value.find((l) => l.requirement_ID === reqId);
}

// ============================================================
// 1. UPLOAD VALIDATION + STORAGE SECURITY (pure unit checks included)
// ============================================================
describe("Sprint 17 - upload validation & storage", () => {
  test("content-addressed storage refuses traversal and non-keys", () => {
    const storage = require("../srv/compliance/document-storage");
    assert.throws(() => storage.readFile("../../etc/passwd"), /Invalid storage key/);
    assert.throws(() => storage.readFile("zz/invalid.bin"), /Invalid storage key/);
    assert.throws(() => storage.readFile("ab/short.bin"), /Invalid storage key/);
    // Path components are dropped; leading dots stripped; result is a
    // plain, safe display name (never used to locate bytes).
    assert.equal(storage.sanitizeFileName("../../etc/passwd"), "passwd");
    assert.ok(storage.sanitizeFileName("my id (1).png#$").indexOf("/") === -1);
  });

  test("oversize byte buffers are rejected by the storage layer", () => {
    const storage = require("../srv/compliance/document-storage");
    const oversized = Buffer.alloc(storage.MAX_DOCUMENT_FILE_SIZE + 1, 0, "utf8");
    assert.throws(() => storage.saveFile(oversized, "big.pdf"), /limit/);
  });

  test("upload sniffes the real content type (client MIME is ignored)", async () => {
    // Declared as pdf, actually PNG bytes -> sniffed type wins.
    const res = await upload({
      employee_ID: JOHN_ID,
      documentType: "Aadhar",
      documentNumber: "PAN-X-1",
      fileName: "my aad har.pdf!",
      mimeType: "application/pdf", // the LIE
      content: b64(PNG),
      issueDate: "2026-01-15",
      expiryDate: "2030-01-15",
    }, JOHN);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const ID = res.data.ID;
    const { data: row } = await GET(`${EMP}/Documents(ID=${ID})`, JOHN);
    assert.equal(row.mimeType, "image/png");
    assert.ok(row.sha256, "sha256 must be stored");
    assert.equal(row.filePath, null, "storage key must never be exposed");
    assert.ok(!/[^A-Za-z0-9._-]/.test(row.fileName), `sanitized filename, got ${row.fileName}`);
    assert.ok(row.fileName.indexOf("/") === -1 && row.fileName.indexOf("\\") === -1);
    assert.equal(row.verificationStatus, "Pending");
  });

  test("disallowed content (plain text) is rejected before anything is stored", async () => {
    await expectError(
      () => upload({
        employee_ID: JOHN_ID,
        documentType: "Resume",
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        content: b64(Buffer.from("this is definitely not a pdf or png/jpeg")),
      }, JOHN),
      400,
      /content type is not allowed/,
    );
  });

  test("clients cannot claim an oversized file with a small declared size", async () => {
    await expectError(
      () => upload({
        employee_ID: JOHN_ID,
        documentType: "Resume",
        fileName: "big.pdf",
        mimeType: "application/pdf",
        content: b64(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024)])),
      }, JOHN),
      413,
    );
  });

  test("metadata-only upload is supported (mimeType required then)", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "ABC123",
      documentType: "Resume",
      fileName: "cv-2024.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    assert.equal(res.status, 201, JSON.stringify(res.data));

    await expectError(
      () => upload({ employee_ID: JOHN_ID, documentType: "Resume", fileName: "x.pdf" }, JOHN),
      400,
      /Mime Type is required/,
    );

    // Housekeeping: clear the Active Resume so later suites of this
    // file start clean (the duplicate guard allows only ONE Active
    // document per employee + type).
    await POST(`${EMP}/Documents(ID=${res.data.ID})/EmployeeService.Archive`, {}, HR);
  });

  test("duplicate Active upload of the same type is refused; retrying after archive works", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "DUPTEST",
      documentType: "PAN",
      fileName: "pan.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    const ID = res.data.ID;

    await expectError(
      () => upload({
        employee_ID: JOHN_ID,
        documentNumber: "DUPTEST2",
        documentType: "PAN",
        fileName: "pan2.pdf",
        mimeType: "application/pdf",
      }, JOHN),
      400,
      /Document already exists/,
    );

    const arch = await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Archive`, {}, HR);
    assert.ok([200, 204].includes(arch.status), JSON.stringify(arch.data ?? arch));

    const again = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "DUPTEST2",
      documentType: "PAN",
      fileName: "pan2.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    assert.equal(again.status, 201, JSON.stringify(again.data));

    // Housekeeping: clear the Active PAN again so later suites of
    // this file start from a clean state (one Active doc per type
    // is the rule the duplicate guard enforces).
    await POST(`${EMP}/Documents(ID=${again.data.ID})/EmployeeService.Archive`, {}, HR);
  });

  test("an employee cannot upload a document for a colleague (cross-employee denial)", async () => {
    await expectError(
      () => upload({
        employee_ID: HR_ID,
        documentType: "Resume",
        fileName: "evil.pdf",
        mimeType: "application/pdf",
      }, JOHN),
      403,
    );
  });

  test("date hygiene: expiry before issue is rejected", async () => {
    await expectError(
      () => upload({
        employee_ID: JOHN_ID,
        documentType: "Passport",
        documentNumber: "TRAVEL9",
        fileName: "p.pdf",
        mimeType: "application/pdf",
        issueDate: "2026-06-01",
        expiryDate: "2026-01-01",
      }, JOHN),
      400,
      /Expiry Date must be on or after the Issue Date/,
    );
  });
});

// ============================================================
// 2. VERIFICATION LIFECYCLE (guarded actions) + AUDIT
// ============================================================
describe("Sprint 17 - verification lifecycle & guards", () => {
  test("employee cannot verify; HR verifies; re-verify/reject-after are refused", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "VERIFY-1",
      documentType: "Passport",
      fileName: "passport.pdf",
      mimeType: "application/pdf",
      issueDate: "2026-01-01",
      expiryDate: isoShift(1000),
    }, JOHN);
    const ID = res.data.ID;

    await expectError(() => verifyDoc(ID, JOHN), 403);
    await expectError(() => verifyDoc(ID, JOHN), 403);

    const v = await verifyDoc(ID);
    assert.ok([200, 204].includes(v.status), JSON.stringify(v.data ?? v));

    const { data: verified } = await GET(`${EMP}/Documents(ID=${ID})`, JOHN);
    assert.equal(verified.verificationStatus, "Verified");
    assert.equal(verified.verified, true);
    assert.ok(verified.verifiedOn, "verifiedOn must be stamped");

    // Finality: racing/duplicate verify must be refused.
    await expectError(() => verifyDoc(ID), 409);
    await expectError(
      () => POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Reject`, { comments: "late reject" }, HR),
      409,
    );

    // Direct PATCH cannot bypass the verification record.
    await expectError(
      () => PATCH(`${EMP}/Documents(ID=${ID})`, { verificationStatus: "Rejected" }, ADMIN),
      400,
      /Verify\/Reject/,
    );

    // Audit must contain the decision (shared audit helper).
    const { data: audit } = await GET(
      `/odata/v4/employee/AuditLogs?$filter=entity eq 'Documents'`,
      ADMIN,
    );
    assert.ok(audit.value.length >= 1, "verification must be audited");
  });

  test("reject requires a reason; rejected docs keep the row (no delete)", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "REJECT-1",
      documentType: "AddressProof",
      fileName: "bill.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    const ID = res.data.ID;

    await expectError(
      () => POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Reject`, {}, HR),
      400,
      /reason is required/,
    );
    const rej = await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Reject`, { comments: "blurry scan" }, HR);
    assert.ok([200, 204].includes(rej.status), JSON.stringify(rej.data ?? rej));

    await expectError(() => DELETE(`${EMP}/Documents(ID=${ID})`, HR), 400, /cannot be deleted/);
  });

  test("protected PATCHes: content, status, storage fields are refused", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "GUARD-1",
      documentType: "Resume",
      fileName: "g.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    const ID = res.data.ID;

    await expectError(() => PATCH(`${EMP}/Documents(ID=${ID})`, { content: b64(PNG) }, JOHN), 400, /Archive/);
    await expectError(() => PATCH(`${EMP}/Documents(ID=${ID})`, { status: "Archived" }, ADMIN), 400, /Archive action/);
    await expectError(() => PATCH(`${EMP}/Documents(ID=${ID})`, { filePath: "../evil" }, ADMIN), 400, /system-managed/);
    await expectError(
      () => PATCH(`${EMP}/Documents(ID=${ID})`, { employee_ID: HR_ID }, ADMIN),
      400,
      /cannot be changed/,
    );
  });
});

// ============================================================
// 3. DOWNLOAD (bytes via action only, privacy enforced)
// ============================================================
describe("Sprint 17 - download authorization", () => {
  test("owner downloads own bytes; colleague and manager are denied; HR can download", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "DL-1",
      documentType: "BackgroundCheck",
      fileName: "check.pdf",
      mimeType: "application/pdf",
      content: b64(PNG),
    }, JOHN);
    const ID = res.data.ID;

    const own = await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Download`, {}, JOHN);
    assert.equal(own.data.fileName, "check.pdf");
    assert.equal(own.data.sha256, res.data.sha256);
    assert.equal(own.data.mimeType, "image/png");
    assert.equal(Buffer.from(own.data.content, "base64").toString("hex"), PNG.toString("hex"), "byte round-trip");

    await expectError(
      () => POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Download`, {}, MGRDEPT),
      403,
    );

    const hrDl = await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Download`, {}, HR);
    assert.ok(hrDl.status === 200, JSON.stringify(hrDl.data ?? hrDl));
  });

  test("employee cannot download another employee's document", async () => {
    const res = await upload({
      employee_ID: HR_ID,
      documentNumber: "HRDL-1",
      documentType: "BackgroundCheck",
      fileName: "hr-check.pdf",
      mimeType: "application/pdf",
      content: b64(PNG),
    }, HR);
    const ID = res.data.ID;

    await expectError(
      () => POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Download`, {}, JOHN),
      403,
    );
  });
});

// ============================================================
// 4. REQUIREMENT CONFIGURATION (admin-only)
// ============================================================
describe("Sprint 17 - requirement configuration", () => {
  test("employees cannot create/update requirements; everyone can read", async () => {
    await expectError(
      () => POST(`${COMP}/DocumentRequirements`, { name: "hax", documentType: "PAN", effectiveFrom: "2026-01-01" }, JOHN),
      403,
    );
    const { data: visible } = await GET(`${COMP}/DocumentRequirements`, JOHN);
    assert.ok(visible.value.some((r) => r.requirementCode === "REQ0001"));
  });

  test("admin creates a requirement; enum + range validation applies", async () => {
    // admin-created config rows must not silently break compliance
    // for other suites of this file - removed again after validation.
    let createdReqId = null;

    await expectError(
      () => POST(`${COMP}/DocumentRequirements`, { name: "bad", documentType: "NotACatalogValue", effectiveFrom: "2026-01-01" }, ADMIN),
      400,
    );
    await expectError(
      () => POST(`${COMP}/DocumentRequirements`, { name: "bad", documentType: "PAN", effectiveFrom: "2026-01-01", expiryAlertDays: 400 }, ADMIN),
      400,
      /0 and 365/,
    );

    const res = await POST(
      `${COMP}/DocumentRequirements`,
      { name: "Test Requirement", documentType: "AddressProof", effectiveFrom: "2026-01-01", expiryAlertDays: 30, isMandatory: true },
      ADMIN,
    );
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.match(res.data.requirementCode, /^REQ\d+$/);

    const { data: reqRow } = await GET(`${COMP}/DocumentRequirements(ID=${res.data.ID})`, ADMIN);
    assert.equal(reqRow.isMandatory, true);

    // Cleanup: this test-only requirement would otherwise add a
    // 5th mandatory line to every employee's compliance summary.
    createdReqId = res.data.ID;
    const del = await DELETE(`${COMP}/DocumentRequirements(ID=${createdReqId})`, ADMIN);
    assert.ok([200, 204].includes(del.status), JSON.stringify(del.data ?? del));
  });
});

// ============================================================
// 5. COMPLIANCE COMPUTATION (core of the sprint)
// ============================================================
describe("Sprint 17 - compliance computation", () => {
  test("initial state: every mandatory requirement is Missing; summary is Incomplete", async () => {
    const { data: s } = await GET(`${COMP}/ComplianceSummaries?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    const john = s.value[0];
    assert.ok(john, JSON.stringify(s));
    assert.equal(john.mandatoryRequirements, 4, "PAN, Degree, Contract, Medical are mandatory for Permanent");
    assert.equal(john.status, "Incomplete");

    const initialLine = await lineFor(JOHN_ID, REQ_PAN, JOHN);
    assert.equal(initialLine.lineStatus, "Missing");
    assert.equal(initialLine.isMandatory, true);
  });

  test("PAN: presence is NOT compliance - verified without issue date stays Pending; with issue date it becomes Compliant", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "PANCOMPL-1",
      documentType: "PAN",
      fileName: "pan-card.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    const ID = res.data.ID;
    await verifyDoc(ID);

    let l = await lineFor(JOHN_ID, REQ_PAN, JOHN);
    assert.equal(l.lineStatus, "Pending", JSON.stringify(l));

    // Metadata correction (allowed PATCH) completes the requirement.
    const upd = await PATCH(`${EMP}/Documents(ID=${ID})`, { issueDate: "2026-02-01" }, JOHN);
    assert.ok([200, 204].includes(upd.status), JSON.stringify(upd.data ?? upd));

    l = await lineFor(JOHN_ID, REQ_PAN, JOHN);
    assert.equal(l.lineStatus, "Compliant", JSON.stringify(l));
  });

  test("Degree (mandatory, Permanent): rejected verification shows Rejected and status Overdue; resubmission fixes", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "DEG-1",
      documentType: "Degree",
      fileName: "degree.pdf",
      mimeType: "application/pdf",
      issueDate: "2018-08-01",
    }, JOHN);
    const ID = res.data.ID;
    await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Reject`, { comments: "unlegible scan" }, HR);

    let l = await lineFor(JOHN_ID, REQ_DEGREE, JOHN);
    assert.equal(l.lineStatus, "Rejected");
    const { data: s1 } = await GET(`${COMP}/ComplianceSummaries?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    assert.equal(s1.value[0].status, "Overdue", "a mandatory rejected document is consequence-prone");

    // Replacement flow: archive the rejected row (HR), upload a corrected one.
    await POST(`${EMP}/Documents(ID=${ID})/EmployeeService.Archive`, {}, HR);
    const res2 = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "DEG-2",
      documentType: "Degree",
      fileName: "degree-v2.pdf",
      mimeType: "application/pdf",
      issueDate: "2018-08-01",
    }, JOHN);
    await verifyDoc(res2.data.ID);

    l = await lineFor(JOHN_ID, REQ_DEGREE, JOHN);
    assert.equal(l.lineStatus, "Compliant", JSON.stringify(l));
  });

  test("EmploymentContract without expiry is Compliant once verified", async () => {
    const res = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "CONTRACT-1",
      documentType: "EmploymentContract",
      fileName: "contract.pdf",
      mimeType: "application/pdf",
    }, JOHN);
    await verifyDoc(res.data.ID);
    const l = await lineFor(JOHN_ID, REQ_CONTRACT, JOHN);
    assert.equal(l.lineStatus, "Compliant");
  });

  test("Medical: verified with far expiry is Expiring (does not downgrade status); passport expired is Expired (optional)", async () => {
    // Housekeeping: the Passport successor row must not collide with
    // the still-Active VERIFY-1 from the verification suite.
    const { data: oldPass } = await GET(
      `${EMP}/Documents?$filter=documentNumber eq 'VERIFY-1'`,
      HR,
    );
    for (const d of oldPass.value.filter((x) => x.status === "Active")) {
      await POST(`${EMP}/Documents(ID=${d.ID})/EmployeeService.Archive`, {}, HR);
    }

    const med = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "MED-1",
      documentType: "MedicalCertificate",
      fileName: "med.pdf",
      mimeType: "application/pdf",
      issueDate: "2026-01-01",
      expiryDate: isoShift(100),
    }, JOHN);
    await verifyDoc(med.data.ID);
    const medLine = await lineFor(JOHN_ID, REQ_MEDICAL, JOHN);
    assert.equal(medLine.lineStatus, "Expiring", JSON.stringify(medLine));

    const pass = await upload({
      employee_ID: JOHN_ID,
      documentNumber: "PASS-1",
      documentType: "Passport",
      fileName: "passport.pdf",
      mimeType: "application/pdf",
      issueDate: "2024-01-01",
      expiryDate: "2026-09-30", // strictly in the past
    }, JOHN);
    await verifyDoc(pass.data.ID);
    const passLine = await lineFor(JOHN_ID, REQ_PASSPORT, JOHN);
    assert.equal(passLine.lineStatus, "Expired");
    assert.equal(passLine.isMandatory, false);

    // Summary: mandatory all fine -> Compliant, but expiring/expired counters set.
    const { data: s } = await GET(`${COMP}/ComplianceSummaries?$filter=employee_ID eq ${JOHN_ID}`, JOHN);
    const john = s.value[0];
    assert.equal(john.status, "Compliant");
    assert.ok(john.expiring >= 1 && john.expired >= 1, JSON.stringify(john));
    assert.ok(john.compliant >= 2);
  });

  test("queries: expiring/expired lines filterable; self-only scope; manager denied", async () => {
    const { data: expired } = await GET(
      `${COMP}/ComplianceLines?$filter=lineStatus eq 'Expired'`,
      ADMIN,
    );
    assert.ok(expired.value.some((l) => l.employee_ID === JOHN_ID && l.documentType === "Passport"));

    // Foreign employee_ID as a plain employee is REJECTED loudly
    // (silently returning an empty own-scope list would hide the
    // authorization error from clients that misuse the filter).
    await expectError(
      () => GET(`${COMP}/ComplianceLines?$filter=employee_ID eq ${HR_ID}`, JOHN),
      403,
      /own compliance/,
    );
    const ownCollected = (await GET(`${COMP}/ComplianceLines`, JOHN)).data.value;
    assert.ok(ownCollected.every((l) => l.employee_ID === JOHN_ID));

    await expectError(() => GET(`${COMP}/ComplianceLines`, MGRDEPT), 403);
    await expectError(
      () => GET(`${COMP}/ComplianceSummaries?$filter=employee_ID eq ${HR_ID}`, JOHN),
      403,
    );
  });
});

// ============================================================
// 6. REMINDERS (manual action, dedupe, privacy)
// ============================================================
describe("Sprint 17 - expiry reminders", () => {
  test("the reminder action is HR/admin-only and deduplicates", async () => {
    await expectError(
      () => POST(`${COMP}/NotifyDocumentExpiries`, { daysBefore: 200 }, JOHN),
      403,
    );

    const run1 = await POST(`${COMP}/NotifyDocumentExpiries`, { daysBefore: 200 }, ADMIN);
    assert.ok(run1.status === 200, JSON.stringify(run1.data));

    const { data: mine } = await GET(
      `${NOTIF}/Notifications?$filter=category eq 'COMPLIANCE'`,
      JOHN,
    );
    const passExpired = mine.value.filter((n) => /expired/i.test(n.title) && /Passport/.test(n.title));
    assert.ok(passExpired.length === 1, `expected exactly 1 passport-expired notification, got ${passExpired.length}`);

    const medical = mine.value.filter((n) => /expires soon/.test(n.title) && /Medical/.test(n.title));
    assert.ok(medical.length <= 1, `no duplicates for the medical reminder`);

    const run2 = await POST(`${COMP}/NotifyDocumentExpiries`, { daysBefore: 200 }, ADMIN);
    assert.ok(run2.status === 200);

    const { data: mine2 } = await GET(`${NOTIF}/Notifications?$filter=category eq 'COMPLIANCE'`, JOHN);
    const passExpired2 = mine2.value.filter((n) => /expired/i.test(n.title) && /Passport/.test(n.title));
    assert.equal(passExpired2.length, 1, "re-running must not duplicate the same reminder");

    // Reminder messages never leak the storage key or coordinates of docs.
    for (const n of mine2.value) {
      assert.ok(!/filePath|\.bin|document-store/.test(JSON.stringify(n)));
    }
  });
});
