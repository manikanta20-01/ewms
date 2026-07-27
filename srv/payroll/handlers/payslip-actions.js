const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;

/**
 * Action: Publish Payslip
 */
async function publishPayslip(req) {
  const tx = cds.transaction(req);
  const payslipId = req.params[0]?.ID || req.params[0];

  const payslip = await tx.run(
    SELECT.one.from("ewms.db.payroll.Payslip").where({ ID: payslipId }),
  );

  if (!payslip) return req.error(404, "Payslip record not found.");
  if (payslip.published) return req.error(400, "Payslip is already published.");

  // Update published metadata flag
  await tx.run(
    UPDATE("ewms.db.payroll.Payslip")
      .set({ published: true, publishedOn: new Date().toISOString() })
      .where({ ID: payslipId }),
  );

  // Audit Logging
  await tx.run(
    INSERT.into("ewms.db.payroll.PayrollHistory").entries({
      payrollProcess_ID: payslip.payrollProcess_ID,
      action: "Published",
      performedBy: req.user.id || "PAYROLL_MGR",
      performedOn: new Date().toISOString(),
      remarks: `Payslip #${payslip.payslipNumber} published for employee view.`,
    }),
  );

  return `Payslip #${payslip.payslipNumber} published successfully.`;
}

module.exports = {
  publishPayslip,
};
