process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e); process.exit(1); });
const cds = require("@sap/cds");
cds.test().then(async () => {
  console.log("BOOT_OK");
  // anonymous access must be denied on every service
  const paths = ["employee/Employees","leave/LeaveRequests","payroll/EmployeeSalaries","attendance/AttendanceRecords","notification/Notifications","workflow/WorkflowInstances","project/Projects","team/Teams","organization/Companies","recruitment/Candidates","performance/PerformanceReviews","asset/Assets"];
  let denied = 0;
  for (const p of paths) {
    try {
      const res = await cds.test.axios.get(`/odata/v4/${p}`);
      console.log(`ANON-ALLOWED ${res.status} ${p}`);
    } catch (e) { if (e.response && (e.response.status === 401 || e.response.status === 403)) denied++; else console.log(`ANON-UNEXPECTED ${p}: ${e.response?.status}`); }
  }
  console.log(`ANON_DENIED=${denied}/${paths.length}`);
  process.exit(0);
}).catch((e) => { console.error("BOOT_FAIL", e); process.exit(1); });
