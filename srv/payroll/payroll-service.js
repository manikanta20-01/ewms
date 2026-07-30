const cds = require("@sap/cds");
const { processPayroll, approvePayrollBatch, lockPayroll, unlockPayroll } = require("./handlers/payroll-engine");
const { recalculatePayroll, rejectPayroll } = require("./handlers/payroll-process-actions");
const { publishPayslip } = require("./handlers/payslip-actions");

module.exports = cds.service.impl(async function () {
  // Bind Actions directly to handler functions
  this.on("ProcessPayroll", "PayrollPeriods", processPayroll);
  this.on("ApprovePayrollBatch", "PayrollPeriods", approvePayrollBatch);
  this.on("LockPayroll", "PayrollPeriods", lockPayroll);
  this.on("UnlockPayroll", "PayrollPeriods", unlockPayroll);

  this.on("RecalculatePayroll", "PayrollProcesses", recalculatePayroll);
  this.on("RejectPayroll", "PayrollProcesses", rejectPayroll);

  this.on("PublishPayslip", "Payslips", publishPayslip);
});