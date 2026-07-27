const cds = require("@sap/cds");
const { SELECT } = cds.ql;

const { required } = require("../../common/utils/validation");
const { generatecode } = require("../../common/utils/code-generator");

module.exports = (srv) => {
  const { SalaryStructures, EmployeeSalaries } = srv.entities;
  const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

  // =================
  // CREATE , UPDATE
  // =================

  srv.before(["CREATE", "UPDATE"], "SalaryStructures", async (req) => {
    const tx = cds.transaction(req);

    const targetId = req.data.ID || req.params[0]?.ID || req.params[0];

    let existingRecord = null;
    if (req.event == "UPDATE" && targetId) {
      existingRecord = await SELECT.one
        .from(SalaryStructures)
        .where({ ID: targetId });
    }

    // handle partial create/update
    const structureName =
      req.data.structureName ?? existingRecord?.structureName;
    const grade_ID = req.data.grade_ID ?? existingRecord?.grade_ID;
    const designation_ID =
      req.data.designation_ID ?? existingRecord?.designation_ID;
    const status = req.data.status ?? existingRecord?.status ?? "Active";

    // CREATE Code
    if (req.event == "CREATE") {
      required(req, "structureName", "Structure Name");
      required(req, "effectiveFrom", "Effective From Date");

      req.data.structureCode = await generatecode(
        req,
        "ewms.db.payroll.SalaryStructure",
        "structureCode",
        "SS",
        6,
      );
    }

    // Duplicate Name Check
    if (structureName) {
      const existingName = await tx.run(
        SELECT.one.from(SalaryStructures)
          .where`LOWER(structureName) = LOWER(${structureName}) AND ID != ${targetId || DUMMY_UUID}`,
      );
      if (existingName)
        return req.error(
          400,
          `Salary Structure name ${structureName} already exists`,
        );
    }

    // Grade + designation unique check
    if (grade_ID && designation_ID && status === "Active") {
      const conflictingStructure = await tx.run(
        SELECT.one.from(SalaryStructures).where({
          grade_ID,
          designation_ID,
          status: "Active",
          ID: { "!=": targetId || DUMMY_UUID },
        }),
      );
      if (conflictingStructure)
        return req.error(
          400,
          `An active Salary Structure ('${conflictingStructure.structureCode}') already exists for this Grade and Designation combination.`,
        );
    }
  });

  // =================
  // DELETE
  // =================
  srv.before("DELETE", "SalaryStructures", async (req) => {
    const tx = cds.transaction(req);
    const targetId = req.data.ID || req.params[0]?.ID || req.params[0];

    if (!targetId) return;

    const assigned = await tx.run(
      SELECT.one.from(EmployeeSalaries).where({
        salaryStructure_ID: targetId,
        status: "Active",
      }),
    );

    if (assigned)
      return req.error(
        400,
        "Deletion prohibited: Salary Structure is currently assigned to one or more active employees.",
      );
  });
};
