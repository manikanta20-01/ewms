// Temporary metadata probe for the regression audit. Deleted after the audit.
const { test } = require("node:test");
const assert = require("node:assert");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);

const HR_AUTH = { auth: { username: "hrperson", password: "" } };

test("metadata probe: every service serves valid OData V4 metadata", async () => {
  const services = ["employee", "leave", "payroll", "attendance", "notification", "workflow", "project", "team", "organization", "recruitment", "performance", "asset"];
  for (const s of services) {
    const { status, data } = await GET(`/odata/v4/${s}/$metadata`, HR_AUTH);
    assert.equal(status, 200, `${s} $metadata failed`);
    assert.match(String(data), /<edmx:Edmx/, `${s} metadata not OData EDMX`);
    assert.match(String(data), /EntityType/, `${s} metadata has no EntityTypes`);
  }
});
