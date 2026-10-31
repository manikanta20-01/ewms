// Temporary probe: seed data integrity across early-sprint modules.
const { test } = require("node:test");
const { startTestHarness } = require("../test/setup");

const harness = startTestHarness();
const GET = harness.GET.bind(harness);

const ADMIN = { auth: { username: "sysadmin", password: "" } };

test("probe seed data integrity", async () => {
  const banks = await GET("/odata/v4/employee/Banks", ADMIN);
  console.log("BANKS:", banks.status, banks.data.value?.length ?? "ERR", JSON.stringify(banks.data.value?.slice(0,2) || banks.data.error || banks.data));

  const stat = await GET("/odata/v4/employee/StatutoryDetails", ADMIN);
  console.log("STATUTORY:", stat.status, stat.data.value?.length ?? "ERR");

  const sal = await GET("/odata/v4/payroll/EmployeeSalaries", ADMIN);
  console.log("SALARIES:", sal.status, sal.data.value?.length ?? "ERR", JSON.stringify(sal.data.value?.slice(0,2) || sal.data.error || sal.data));

  const ssi = await GET("/odata/v4/payroll/SalaryStructureItems", ADMIN);
  console.log("STRUCT_ITEMS:", ssi.status, ssi.data.value?.length ?? "ERR", JSON.stringify(ssi.data.value?.slice(0,2) || ssi.data.error || ssi.data));

  const hist = await GET("/odata/v4/employee/EmployeeHistory", ADMIN);
  console.log("EMP_HISTORY:", hist.status, hist.data.value?.length ?? "ERR", JSON.stringify(hist.data.value?.slice(0,1) || hist.data.error || hist.data));

  const overtime = await GET("/odata/v4/attendance/Overtimes", ADMIN);
  console.log("OVERTIME:", overtime.status, overtime.data.value?.length ?? "ERR");
});
