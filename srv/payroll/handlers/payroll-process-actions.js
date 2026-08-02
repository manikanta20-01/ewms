const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

/**
 * Action: Recalculate Payroll for an individual Employee Process Record
 * (Used when HR fixes attendance/leave/bank details after a batch exception)
 */
async function recalculatePayroll(req) {
  const tx = cds.transaction(req);
  const processId = req.params[0]?.ID || req.params[0];

  // 1. Fetch Process Record & Period
  const processRec = await tx.run(
    SELECT.one.from("ewms.db.payroll.PayrollProcess").where({ ID: processId }),
  );
  if (!processRec)
    return req.error(404, "Target Payroll Process record not found.");

  const period = await tx.run(
    SELECT.one
      .from("ewms.db.payroll.PayrollPeriod")
      .where({ ID: processRec.payrollPeriod_ID }),
  );
  if (period.isLocked)
    return req.error(400, "Cannot recalculate payroll for a locked period.");

  if (processRec.status === "Approved" || processRec.status === "Published") {
    return req.error(
      400,
      `Cannot recalculate a payroll record in '${processRec.status}' status.`,
    );
  }

  // 2. Fetch Employee Salary Structure
  const sal = await tx.run(
    SELECT.one.from("ewms.db.payroll.EmployeeSalary").where({
      employee_ID: processRec.employee_ID,
      status: "Active",
    }),
  );
  if (!sal)
    return req.error(400, "Active employee salary CTC mapping missing.");

  // Fetch Structure Items
  const items = await tx.run(
    SELECT.from("ewms.db.payroll.SalaryStructureItem").where({
      salaryStructure_ID: sal.salaryStructure_ID,
    }),
  );
  if (!items.length)
    return req.error(400, "Assigned Salary Structure has no items defined.");

  // 3. Re-read Attendance & Compute Days
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
  const weekOffs = attendanceRecords.filter(
    (a) => a.attendanceStatus === "WeekOff",
  ).length;
  const holidays = attendanceRecords.filter(
    (a) => a.attendanceStatus === "Holiday",
  ).length;

  const lopDays = absentDays + halfDays * 0.5;
  const workingDays = Number(period.workingDays);
  const payableDays = Math.max(0, workingDays - lopDays);

  // 4. Overtime Recalculation
  const overtimeRecords = await tx.run(
    SELECT.from("ewms.db.attendance.Overtime").where({
      employee_ID: sal.employee_ID,
      status: "Approved",
    }),
  );
  const totalOtHours = overtimeRecords.reduce(
    (sum, ot) => sum + Number(ot.approvedHours || 0),
    0,
  );
  const perDayRate = Number(sal.monthlyCTC) / workingDays;
  const hourlyRate = perDayRate / 8;
  const overtimePay = Number((totalOtHours * hourlyRate * 1.5).toFixed(2));

  let totalEarnings = 0;
  let totalDeductions = 0;
  const newDetails = [];

  for (const item of items) {
    const comp = await tx.run(
      SELECT.one
        .from("ewms.db.payroll.SalaryComponent")
        .where({ ID: item.salaryComponent_ID }),
    );
    let calculatedAmt = 0;

    if (comp.calculationType === "Fixed") {
      calculatedAmt = Number(item.amount);
    } else if (comp.calculationType === "Percentage") {
      calculatedAmt = Number(sal.monthlyCTC) * (Number(item.percentage) / 100);
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

    newDetails.push({
      salaryComponent_ID: comp.ID,
      calculatedAmount: calculatedAmt,
    });
  }

  totalEarnings += overtimePay;
  const grossSalary = totalEarnings;
  const netSalary = Number((grossSalary - totalDeductions).toFixed(2));

  // 5. Delete Old Line-Item Details & Update Header
  await tx.run(
    DELETE.from("ewms.db.payroll.PayrollDetail").where({
      payrollProcess_ID: processId,
    }),
  );

  await tx.run(
    UPDATE("ewms.db.payroll.PayrollProcess")
      .set({
        presentDays,
        absentDays,
        lopDays,
        halfDays,
        weekOffs,
        holiday: holidays,
        overtimeHours: totalOtHours,
        overtimePay,
        grossSalary,
        totalEarnings,
        totalDeductions,
        netSalary,
        processStatus: "Processed",
      })
      .where({ ID: processId }),
  );

  // Insert New Line Items
  for (const detail of newDetails) {
    await tx.run(
      INSERT.into("ewms.db.payroll.PayrollDetail").entries({
        payrollProcess_ID: processId,
        salaryComponent_ID: detail.salaryComponent_ID,
        calculatedAmount: detail.calculatedAmount,
      }),
    );
  }

  // 6. Log Audit Entry
  await tx.run(
    INSERT.into("ewms.db.payroll.PayrollHistory").entries({
      payrollProcess_ID: processId,
      action: "Recalculated",
      performedBy_ID: req.user.attr?.employeeId || processRec.employee_ID,
      performedOn: new Date().toISOString(),
      remarks: `Single employee recalculation complete. Net Salary: ₹${netSalary}.`,
    }),
  );

  return `Recalculation successful for Process ID ${processId}. Net Salary updated to ₹${netSalary}.`;
}

/**
 * Action: Reject Payroll Process Record
 */
async function rejectPayroll(req) {
  const tx = cds.transaction(req);
  const processId = req.params[0]?.ID || req.params[0];
  const { reason } = req.data;

  await tx.run(
    UPDATE("ewms.db.payroll.PayrollProcess")
      .set({ processStatus: "Rejected" })
      .where({ ID: processId }),
  );

  await tx.run(
    INSERT.into("ewms.db.payroll.PayrollHistory").entries({
      payrollProcess_ID: processId,
      action: "Rejected",
      performedBy_ID: req.user.attr?.employeeId || processRec.employee_ID,
      performedOn: new Date().toISOString(),
      remarks: reason || "Payroll process rejected during review.",
    }),
  );

  return `Payroll process record ${processId} marked as Rejected.`;
}

module.exports = {
  recalculatePayroll,
  rejectPayroll,
};
