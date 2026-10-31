// Temporary boot/anon probe for the regression audit. Deleted after the audit.
const { test } = require("node:test");
const assert = require("node:assert");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);

test("boot probe: all services respond + anonymous denied", async () => {
  const paths = [
    "employee/Employees", "leave/LeaveRequests", "payroll/EmployeeSalaries",
    "attendance/Attendances", "notification/Notifications",
    "workflow/WorkflowInstances", "project/Projects", "team/Teams",
    "organization/Companies", "recruitment/Candidates",
    "performance/Reviews", "asset/Assets",
  ];
  for (const p of paths) {
    const { status, data } = await GET(`/odata/v4/${p}?%24top=1`, HR_AUTH);
    assert.ok(status === 200, `${p} failed: ${status} ${JSON.stringify(data)}`);
  }

  for (const p of paths) {
    await expectStatus(() => GET(`/odata/v4/${p}?%24top=1`, NO_AUTH), [401, 403], p);
  }
});

const HR_AUTH = { auth: { username: "hrperson", password: "" } };
const NO_AUTH = {};

async function expectStatus(fn, codes, label) {
  try {
    await fn();
    assert.fail(`${label}: expected denial`);
  } catch (err) {
    const code = err.response?.status;
    assert.ok(codes.includes(code), `${label}: expected ${codes} but got ${code}`);
  }
}
