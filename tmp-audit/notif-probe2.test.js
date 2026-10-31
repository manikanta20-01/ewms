// Temporary probe 2: notification insert + MarkAsRead behavior.
const { test } = require("node:test");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);
const POST = harness.POST.bind(harness);

const JOHN = { auth: { username: "empjohn", password: "" } };
const ADMIN = { auth: { username: "sysadmin", password: "" } };
const JOHN_EMP_ID = "10000000-0000-0000-0000-000000000001";

test("probe notification flow fully", async () => {
  await POST(
    "/odata/v4/notification/CreateNotification",
    { recipient_ID: JOHN_EMP_ID, title: "probe2", message: "probe message 2", category: "SYSTEM" },
    ADMIN,
  );

  const after = await GET("/odata/v4/notification/Notifications", JOHN);
  console.log("JOHN_INBOX rows:", after.data.value?.length, JSON.stringify(after.data.value || []));

  const adminView = await GET("/odata/v4/notification/Notifications", ADMIN);
  console.log("ADMIN_INBOX rows:", adminView.data.value?.length);

  const row = after.data.value?.[0];
  if (row) {
    try {
      const res = await POST(`/odata/v4/notification/Notifications(ID=${row.ID})/NotificationService.MarkAsRead`, {}, JOHN);
      console.log("MARK_OK", res.status, JSON.stringify(res.data));
      const re = await GET("/odata/v4/notification/Notifications", JOHN);
      console.log("STATUS_AFTER", JSON.stringify(re.data.value?.map((r) => ({ t: r.title, s: r.status, readAt: r.readAt }))));
    } catch (e) {
      console.log("MARK_FAIL status:", e.response?.status, "msg:", String(e.response?.data?.error?.message).slice(0, 200));
    }
  }
});
