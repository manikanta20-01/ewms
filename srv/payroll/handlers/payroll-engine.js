const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

/**
 * Enterprise Payroll Engine Implementation
 * Strictly aligned with ewms.db.payroll CDS Entities
 */
async function processPayroll(req) {
  const tx = cds.transaction(req);
  const periodId = req.params[0]?.ID || req.params[0];

  // 1. Fetch & Verify Target Payroll Period
  const period = await tx.run(
    SELECT.one.from("ewms.db.payroll.PayrollPeriod").where({ ID: periodId }),
  );

  if (!period) return req.error(404, "Target Payroll Period not found.");
  if (period.isLocked) {
    return req.error(
      400,
      `Cannot process locked Payroll Period '${period.payrollCode}'.`,
    );
  }

  const workingDays = Number(period.workingDays || 0);
  if (workingDays <= 0) {
    return req.error(
      400,
      `Payroll Period '${period.payrollCode}' has invalid working days.`,
    );
  }

  // 2. Simple Flat Query for Active Employee Salaries
  const activeSalaries = await tx.run(
    SELECT.from("ewms.db.payroll.EmployeeSalary").where({ status: "Active" }),
  );

  if (!activeSalaries.length) {
    return req.error(
      400,
      "No active employee CTC records found for processing.",
    );
  }

  let successCount = 0;
  let failedCount = 0;

  // Clear previous unprocessed calculations for this period
  await tx.run(
    DELETE.from("ewms.db.payroll.PayrollProcess").where({
      payrollPeriod_ID: periodId,
      processStatus: { in: ["Pending", "Processed"] },
    }),
  );

  // 3. Process Batch Iteration
  for (const sal of activeSalaries) {
    try {
      const structId = sal.salaryStructure_ID;

      // Direct Query for Line Items to ensure items exist
      const items = await tx.run(
        SELECT.from("ewms.db.payroll.SalaryStructureItem").where({
          salaryStructure_ID: structId,
        }),
      );

      if (!items || !items.length) {
        throw new Error(
          `Salary Structure '${structId}' has no defined components in SalaryStructureItem.`,
        );
      }

      // Fetch Attendance Records
      const attendanceRecords = await tx.run(
        SELECT.from("ewms.db.attendance.Attendance").where({
          employee_ID: sal.employee_ID,
          attendanceDate: { ">=": period.startDate, "<=": period.endDate },
        }),
      );

      const presentDays = attendanceRecords.filter(
        (a) => a.attendanceStatus === "Present",
      ).length;
      const absentDays = attendanceRecords.filter(
        (a) => a.attendanceStatus === "Absent",
      ).length;
      const halfDays = attendanceRecords.filter(
        (a) => a.attendanceStatus === "HalfDay",
      ).length;

      const lopDays = absentDays + halfDays * 0.5;
      const payableDays = Math.max(0, workingDays - lopDays);

      let totalEarnings = 0;
      let totalDeductions = 0;
      const generatedDetails = [];

      for (const item of items) {
        // Fetch Component Details Directly
        const comp = await tx.run(
          SELECT.one
            .from("ewms.db.payroll.SalaryComponent")
            .where({ ID: item.salaryComponent_ID }),
        );

        if (!comp) continue;

        let calculatedAmt = 0;
        if (comp.calculationType === "Fixed") {
          calculatedAmt = Number(item.amount || 0);
        } else if (comp.calculationType === "Percentage") {
          calculatedAmt =
            Number(sal.monthlyCTC) * (Number(item.percentage || 0) / 100);
        }

        if (comp.componentType === "Earning") {
          calculatedAmt = Number(
            ((calculatedAmt / workingDays) * payableDays).toFixed(2),
          );
          totalEarnings += calculatedAmt;
        } else {
          calculatedAmt = Number(calculatedAmt.toFixed(2));
          totalDeductions += calculatedAmt;
        }

        generatedDetails.push({
          salaryComponent_ID: comp.ID,
          calculatedAmount: calculatedAmt,
        });
      }

      const grossSalary = Number(totalEarnings.toFixed(2));
      const netSalary = Number((grossSalary - totalDeductions).toFixed(2));

      if (netSalary < 0) {
        throw new Error("Calculated Net Salary cannot be negative.");
      }

      const processId = cds.utils.uuid();

      // Insert Header
      await tx.run(
        INSERT.into("ewms.db.payroll.PayrollProcess").entries({
          ID: processId,
          payrollPeriod_ID: periodId,
          employee_ID: sal.employee_ID,
          workingDays: workingDays,
          presentDays: presentDays,
          lopDays: lopDays,
          grossSalary: grossSalary,
          totalDeductions: totalDeductions,
          netSalary: netSalary,
          processStatus: "Processed",
        }),
      );

      // Insert Line Items
      if (generatedDetails.length > 0) {
        const detailEntries = generatedDetails.map((d) => ({
          ID: cds.utils.uuid(),
          payrollProcess_ID: processId,
          salaryComponent_ID: d.salaryComponent_ID,
          calculatedAmount: d.calculatedAmount,
        }));

        await tx.run(
          INSERT.into("ewms.db.payroll.PayrollDetail").entries(detailEntries),
        );
      }

      // Insert Audit Trail
      await tx.run(
        INSERT.into("ewms.db.payroll.PayrollHistory").entries({
          ID: cds.utils.uuid(),
          payrollProcess_ID: processId,
          action: "Processed",
          performedBy_ID: sal.employee_ID,
          performedOn: new Date().toISOString(),
          remarks: `Payroll processed successfully. Payable days: ${payableDays}/${workingDays}.`,
        }),
      );

      successCount++;
    } catch (err) {
      console.error(
        `[PayrollEngine Error] Employee ${sal.employee_ID}:`,
        err.message || err,
      );
      failedCount++;
    }
  }

  // Update Period Timestamp
  await tx.run(
    UPDATE("ewms.db.payroll.PayrollPeriod")
      .set({ processedOn: new Date().toISOString() })
      .where({ ID: periodId }),
  );

  return `Payroll Execution Summary for Period '${period.payrollCode}': Processed: ${successCount}, Exceptions/Failed: ${failedCount}.`;
}

/**
 * Batch Approval Strategy
 */
async function approvePayrollBatch(req) {
  const tx = cds.transaction(req);
  const periodId = req.params[0]?.ID || req.params[0];

  const records = await tx.run(
    SELECT.from("ewms.db.payroll.PayrollProcess").where({
      payrollPeriod_ID: periodId,
      processStatus: "Processed",
    }),
  );

  if (!records.length) {
    return req.error(
      400,
      "No 'Processed' payroll records available in this batch for approval.",
    );
  }

  await tx.run(
    UPDATE("ewms.db.payroll.PayrollProcess")
      .set({ processStatus: "Approved" })
      .where({ payrollPeriod_ID: periodId, processStatus: "Processed" }),
  );

  const timestamp = new Date().toISOString();

  for (const rec of records) {
    await tx.run(
      INSERT.into("ewms.db.payroll.Payslip").entries({
        ID: cds.utils.uuid(),
        payrollProcess_ID: rec.ID,
        payslipNumber: `PSL-${Date.now()}-${rec.ID.substring(0, 4)}`,
        generatedOn: timestamp,
      }),
    );

    await tx.run(
      INSERT.into("ewms.db.payroll.PayrollHistory").entries({
        ID: cds.utils.uuid(),
        payrollProcess_ID: rec.ID,
        action: "Approved",
        performedBy_ID: rec.employee_ID,
        performedOn: timestamp,
        remarks: "Batch approval executed.",
      }),
    );
  }

  return `Batch Approval Complete! Approved ${records.length} employee payroll records. Payslips generated.`;
}

async function lockPayroll(req) {
  const tx = cds.transaction(req);
  const periodId = req.params[0]?.ID || req.params[0];

  const period = await tx.run(
    SELECT.one.from("ewms.db.payroll.PayrollPeriod").where({ ID: periodId }),
  );

  if (!period) {
    return req.error(404, `Payroll period not found for ID '${periodId}'.`);
  }

  const payrollNumber = period.payrollCode || periodId;

  if (period.isLocked) {
    return `Payroll ${payrollNumber} is already locked. No changes made.`;
  }

  await tx.run(
    UPDATE("ewms.db.payroll.PayrollPeriod")
      .set({ isLocked: true })
      .where({ ID: periodId }),
  );

  return `Payroll ${payrollNumber} locked successfully. Modifications are now disabled.`;
}

async function unlockPayroll(req) {
  const tx = cds.transaction(req);
  const periodId = req.params[0]?.ID || req.params[0];

  const period = await tx.run(
    SELECT.one.from("ewms.db.payroll.PayrollPeriod").where({ ID: periodId }),
  );

  if (!period) {
    return req.error(404, `Payroll period not found for ID '${periodId}'.`);
  }

  const payrollNumber = period.payrollCode || periodId;

  if (!period.isLocked) {
    return `Payroll ${payrollNumber} is already unlocked. No changes made.`;
  }

  await tx.run(
    UPDATE("ewms.db.payroll.PayrollPeriod")
      .set({ isLocked: false })
      .where({ ID: periodId }),
  );

  return `Payroll ${payrollNumber} unlocked successfully.`;
}

module.exports = {
  processPayroll,
  approvePayrollBatch,
  lockPayroll,
  unlockPayroll,
};
