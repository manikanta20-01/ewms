// Temporary probe: notification actions + guard behaviors. Deleted after audit.
const { test } = require("node:test");
const assert = require("node:assert");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);
const POST = harness.POST.bind(harness);

const JOHN = { auth: { username: "empjohn", password: "" } };
const ADMIN = { auth: { username: "sysadmin", password: "" } };
const JOHN_EMP_ID = "10000000-0000-0000-0000-000000000001";

test("probe notification actions", async () => {
  // unread inbox first
  const inbox = await GET("/odata/v4/notification/Notifications?$filter=status eq 'Unread'", JOHN);
  console.log("INBOX status:", inbox.status, "rows:", inbox.data.value?.length);

  // CreateNotification via admin backdoor
  let created;
  try {
    const res = await POST(
      "/odata/v4/notification/CreateNotification",
      { recipient_ID: JOHN_EMP_ID, title: "probe", message: "probe message", category: "SYSTEM" },
      ADMIN,
    );
    console.log("CREATE_OK", res.status, JSON.stringify(res.data));
    created = res.data;
  } catch (e) {
    console.log("CREATE_FAIL status:", e.response?.status, "msg:", String(e.response?.data?.error?.message).slice(0, 160));
  }

  if (created) {
    const after = await GET("/odata/v4/notification/Notifications", JOHN);
    console.log("INBOX_AFTER rows:", after.data.value?.length, JSON.stringify(after.data.value?.[0]));
  }
});

test("probe MarkAsRead", async () => {
  const inbox = await GET("/odata/v4/notification/Notifications", JOHN);
  const row = inbox.data.value?.[0];
  if (!row) return console.log("no notification to test MarkAsRead");
  try {
    const res = await POST(`/odata/v4/notification/Notifications(ID=${row.ID})/NotificationService.MarkAsRead`, {}, JOHN);
    console.log("MARK_OK", res.status, JSON.stringify(res.data));
  } catch (e) {
    console.log("MARK_FAIL status:", e.response?.status, "msg:", String(e.response?.data?.error?.message).slice(0, 200));
  }
});
