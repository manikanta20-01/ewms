// Temporary probe: verify notification actions after fix.
const { test } = require("node:test");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);
const POST = harness.POST.bind(harness);

const JOHN = { auth: { username: "empjohn", password: "" } };
const ADMIN = { auth: { username: "sysadmin", password: "" } };
const JOHN_EMP_ID = "10000000-0000-0000-0000-000000000001";

test("probe notification flow after fix", async () => {
  const created = await POST(
    "/odata/v4/notification/CreateNotification",
    { recipient_ID: JOHN_EMP_ID, title: "probe3", message: "probe message 3", category: "SYSTEM" },
    ADMIN,
  );
  console.log("CREATE", created.status, JSON.stringify(created.data));

  const after = await GET("/odata/v4/notification/Notifications", JOHN);
  console.log("JOHN_INBOX", JSON.stringify(after.data.value?.map((r) => ({ t: r.title, s: r.status }))));

  const row = after.data.value?.find((r) => r.title === "probe3");
  const mark = await POST(`/odata/v4/notification/Notifications(ID=${row.ID})/NotificationService.MarkAsRead`, {}, JOHN);
  console.log("MARK", mark.status, JSON.stringify(mark.data));
  const re = await GET("/odata/v4/notification/Notifications", JOHN);
  console.log("AFTER_MARK", JSON.stringify(re.data.value?.map((r) => ({ t: r.title, s: r.status, at: !!r.readAt }))));
});
