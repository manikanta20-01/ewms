const cds = require("@sap/cds");
const {
  processPayroll,
  approvePayrollBatch,
  lockPayroll,
  unlockPayroll,
} = require("./handlers/payroll-engine");

/**
 * EWMS Payroll Service Class Implementation
 */
module.exports = cds.service.impl(async function () {
  const { PayrollPeriods, PayrollProcesses } = this.entities;

  this.on('ProcessPayroll', PayrollPeriods, async (req) => {
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
