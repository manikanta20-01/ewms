const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { required } = require("../../common/utils/validation");

module.exports = (srv) => {
  // Target entity definitions (resolving from srv.entities or fallback strings)
  const EmployeeSalaries =
    srv.entities.EmployeeSalaries || "ewms.db.payroll.EmployeeSalary";
  const SalaryStructures =
    srv.entities.SalaryStructures || "ewms.db.payroll.SalaryStructure";
  const Employees = srv.entities.Employees || "ewms.db.employee.Employee";

  // ===================================================
  // CREATE / UPDATE: Validations & History Management
  // ===================================================
  srv.before(["CREATE", "UPDATE"], EmployeeSalaries, async (req) => {
    // Standard key extraction for CAP bound requests
    const target_id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];

    // Fetch existing record on UPDATE
    let existingRecord = null;
    if (req.event === "UPDATE" && target_id) {
      existingRecord = await SELECT.one
        .from(EmployeeSalaries)
        .where({ ID: target_id });
    }

    const employee_ID = req.data.employee_ID ?? existingRecord?.employee_ID;
    const salaryStructure_ID =
      req.data.salaryStructure_ID ?? existingRecord?.salaryStructure_ID;
    const monthlyCTC = req.data.monthlyCTC ?? existingRecord?.monthlyCTC;

    // 1. Validate Monthly CTC (> 0)
    if (monthlyCTC !== undefined && Number(monthlyCTC) <= 0) {
      return req.error(400, "Monthly CTC must be greater than zero.");
    }

    // ===================================================
    // CREATE-ONLY CHECKS & HISTORY AUTO-DELIMITING
    // ===================================================
    if (req.event === "CREATE") {
      required(req, "employee_ID", "Employee");
      required(req, "salaryStructure_ID", "Salary Structure");
      required(req, "effectiveFrom", "Effective From");
      required(req, "monthlyCTC", "Monthly CTC");

      // 2. Verify Employee exists (using resolved Employees entity)
      const employee = await SELECT.one
        .from(Employees)
        .where({ ID: employee_ID });
      if (!employee) {
        return req.error(400, "Employee record does not exist.");
      }

      // 3. Verify Salary Structure exists and is Active
      const structure = await SELECT.one
        .from(SalaryStructures)
        .where({ ID: salaryStructure_ID });
      if (!structure) {
        return req.error(400, "Salary Structure does not exist.");
      }
      if (structure.status !== "Active") {
        const structureLabel =
          structure.structureCode ||
          structure.structureName ||
          salaryStructure_ID;
        return req.error(
          400,
          `Cannot assign inactive Salary Structure '${structureLabel}'.`,
        );
      }

      // 4. Check for existing Active Salary record to auto-delimit
      const currentActive = await SELECT.one.from(EmployeeSalaries).where({
        employee_ID,
        status: "Active",
      });

      if (currentActive) {
        const newEffectiveFrom = new Date(req.data.effectiveFrom);
        const currentEffectiveFrom = new Date(currentActive.effectiveFrom);

        // Date overlapping validation
        if (newEffectiveFrom <= currentEffectiveFrom) {
          return req.error(
            400,
            `New Effective From date (${req.data.effectiveFrom}) must be after current active salary start date (${currentActive.effectiveFrom}).`,
          );
        }

        // Calculate previous day to close prior active record
        const prevEndDate = new Date(req.data.effectiveFrom);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        const formattedDate = prevEndDate.toISOString().split("T")[0];

        // Auto-close and mark prior record as Inactive
        await UPDATE(EmployeeSalaries)
          .set({
            effectiveTo: formattedDate,
            status: "Inactive",
          })
          .where({ ID: currentActive.ID });
      }
    }
  });
};
