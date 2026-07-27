const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {
  // -----------------------------------------------------------------
  // 1. REGISTER CRUD & VALIDATION HANDLERS
  // -----------------------------------------------------------------
  require("./handlers/salary-component")(this);
  require("./handlers/salary-structure")(this);
  require("./handlers/salary-structure-item")(this);
  require("./handlers/employee-salary")(this);
  // require("./handlers/payroll-period")(this); // file doesn't exist yet
  // require("./handlers/payslip")(this); // file doesn't exist yet
  require("./handlers/payroll-history")(this);

  // -----------------------------------------------------------------
  // 2. IMPORT BATCH ENGINE & WORKFLOW ACTIONS
  // -----------------------------------------------------------------
  const {
    processPayroll,
    approvePayrollBatch,
    lockPayroll,
    unlockPayroll,
  } = require("./handlers/payroll-engine");

  const {
    recalculatePayroll,
    rejectPayroll,
  } = require("./handlers/payroll-process-actions");

  const { publishPayslip } = require("./handlers/payslip-actions");

  // -----------------------------------------------------------------
  // 3. ATTACH ACTION HOOKS TO PROJECTIONS
  // -----------------------------------------------------------------
  this.on("ProcessPayroll", "PayrollPeriods", processPayroll);
  this.on("ApprovePayrollBatch", "PayrollPeriods", approvePayrollBatch);
  this.on("LockPayroll", "PayrollPeriods", lockPayroll);
  this.on("UnlockPayroll", "PayrollPeriods", unlockPayroll);

  this.on("RecalculatePayroll", "PayrollProcesses", recalculatePayroll);
  this.on("RejectPayroll", "PayrollProcesses", rejectPayroll);

  this.on("PublishPayslip", "Payslips", publishPayslip);
});