const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { required } = require("../../common/utils/validation");

// ---------> component means (HRA, Basic, ...)
module.exports = (srv) => {
  // ==============
  // CREATE
  // ==============

  srv.before(["CREATE", "UPDATE"], "SalaryComponents", async (req) => {
    const tx = cds.transaction(req);

    const { componentCode, componentName } = req.data;
    if (req.event == "CREATE") {
      required(req, "componentCode", "Component Code");
      required(req, "componentName", "Component Name");

      const exisiting = await tx.run(
        SELECT.one
          .from("ewms.db.payroll.SalaryComponent")
          .where({ componentCode }),
      );
      if (exisiting)
        return req.error(
          400,
          `Salary component code ${componentCode} already exsists`,
        );
    }
  });
  // ==============
  // DELETE
  // ==============

  srv.before("DELETE", "SalaryComponents", async (req) => {
    const tx = cds.transaction(req);

    const targetId = req.data.ID || req.params[0]?.ID || req.params[0];

    const assigned = await tx.run(
      SELECT.one
        .from("ewms.db.payroll.SalaryStructureItem")
        .where({ salaryComponent_ID: targetId }),
    );

    if (assigned)
      return req.error(
        400,
        "Cannot delete component: It is currently assigned to one or more active Salary Structures.",
      );
  });
};
