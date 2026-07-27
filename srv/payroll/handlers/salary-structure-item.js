const cds = require("@sap/cds");
const { required } = require("../../common/utils/validation");
const { SELECT } = cds.ql;

module.exports = (srv) => {
  // ===============
  // CREATE / UPDATE
  // ===============
  srv.before(["CREATE", "UPDATE"], "SalaryStructureItems", async (req) => {
    const tx = req.tx; // Standard CAP transaction object

    // Handle deep association payload structures
    let salaryStructure_ID = req.data.salaryStructure_ID || req.data.salaryStructure?.ID;
    let salaryComponent_ID = req.data.salaryComponent_ID || req.data.salaryComponent?.ID;

    // Handle missing payload fields during PATCH/UPDATE
    if (req.event === "UPDATE" && (!salaryStructure_ID || !salaryComponent_ID)) {
      const current = await tx.run(
        SELECT.one.from("ewms.db.payroll.SalaryStructureItem").where({ ID: req.data.ID })
      );
      if (current) {
        salaryStructure_ID = salaryStructure_ID || current.salaryStructure_ID;
        salaryComponent_ID = salaryComponent_ID || current.salaryComponent_ID;
      }
    }

    // Required Field Validations
    if (!salaryStructure_ID) required(req, "salaryStructure_ID", "Salary Structure");
    if (!salaryComponent_ID) required(req, "salaryComponent_ID", "Salary Component");

    // Check Duplicate Salary Component within the same Structure
    const duplicate = await tx.run(
      SELECT.one.from("ewms.db.payroll.SalaryStructureItem").where({
        salaryStructure_ID,
        salaryComponent_ID,
        ID: { "!=": req.data.ID || "00000000-0000-0000-0000-000000000000" },
      })
    );

    if (duplicate) {
      return req.error(400, "This Salary Component is already added to the structure.");
    }

    // Validate Amount
    if (req.data.amount !== undefined && Number(req.data.amount) < 0) {
      return req.error(400, "Component Amount cannot be negative.");
    }

    // Validate Percentage
    if (req.data.percentage !== undefined) {
      const perc = Number(req.data.percentage);
      if (perc < 0 || perc > 100) {
        return req.error(400, "Component Percentage must be between 0.00% and 100.00%.");
      }
    }
  });
};