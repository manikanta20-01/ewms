const cds = require("@sap/cds");
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
const { registerAuditHooks } = require("../common/utils/audit");

/**
 * EWMS Payroll Service Class Implementation
 */
module.exports = cds.service.impl(async function () {
  const { PayrollPeriods, PayrollProcesses, Payslips } = this.entities;

  // Attach the Enterprise Audit Framework
  registerAuditHooks(this, {
    include: [
      "PayrollPeriods",
      "PayrollProcesses",
      "EmployeeSalaries",
      "PayrollHistories",
      "SalaryComponents",
      "SalaryStructures",
      "SalaryStructureItems",
      "PayrollDetails",
      "Payslips",
    ],
  });

  this.on("ProcessPayroll", PayrollPeriods, async (req) => {
    return await processPayroll(req);
  });

  // ------------------------------------------------------------------
  // BOUND ACTIONS (Bound to PayrollPeriods)
  // ------------------------------------------------------------------

  this.on("ProcessPayroll", PayrollPeriods, async (req) => {
    return await processPayroll(req);
  });

  this.on("ApprovePayrollBatch", PayrollPeriods, async (req) => {
    return await approvePayrollBatch(req);
  });

  this.on("LockPayroll", PayrollPeriods, async (req) => {
    return await lockPayroll(req);
  });

  this.on("UnlockPayroll", PayrollPeriods, async (req) => {
    return await unlockPayroll(req);
  });

  // ------------------------------------------------------------------
  // BOUND ACTIONS (Bound to PayrollProcesses / Payslips)
  // ------------------------------------------------------------------

  this.on("RecalculatePayroll", PayrollProcesses, async (req) => {
    return await recalculatePayroll(req);
  });

  this.on("RejectPayroll", PayrollProcesses, async (req) => {
    return await rejectPayroll(req);
  });

  this.on("PublishPayslip", this.entities.Payslips, async (req) => {
    return await publishPayslip(req);
  });

  // ------------------------------------------------------------------
  // UNBOUND / STANDALONE ACTIONS (Fallback Binding)
  // ------------------------------------------------------------------

  this.on("ProcessPayroll", async (req) => {
    return await processPayroll(req);
  });

  this.on("ApprovePayrollBatch", async (req) => {
    return await approvePayrollBatch(req);
  });

  this.on("LockPayroll", async (req) => {
    return await lockPayroll(req);
  });

  this.on("UnlockPayroll", async (req) => {
    return await unlockPayroll(req);
  });

  this.on("RecalculatePayroll", async (req) => {
    return await recalculatePayroll(req);
  });

  this.on("RejectPayroll", async (req) => {
    return await rejectPayroll(req);
  });

  this.on("PublishPayslip", async (req) => {
    return await publishPayslip(req);
  });

  // ------------------------------------------------------------------
  // PERSISTENT AUDIT HOOK (Logs modifications to PayrollProcess)
  // ------------------------------------------------------------------

  this.after(["CREATE", "UPDATE"], PayrollProcesses, async (data, req) => {
    const tx = cds.transaction(req);
    const records = Array.isArray(data) ? data : [data];

    for (const rec of records) {
      if (rec.ID) {
        await tx.run(
          INSERT.into("ewms.db.payroll.PayrollHistory").entries({
            ID: cds.utils.uuid(),
            payrollProcess_ID: rec.ID,
            action: req.event === "CREATE" ? "Processed" : "Updated",
            performedBy_ID: req.user?.id || rec.employee_ID || "SYSTEM",
            performedOn: new Date().toISOString(),
            remarks: `Entity ${req.event} event logged for record '${rec.ID}'.`,
          }),
        );
      }
    }
  });
});
