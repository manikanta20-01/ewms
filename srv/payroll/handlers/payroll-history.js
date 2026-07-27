const cds = require("@sap/cds");

module.exports = (srv) => {
  const { PayrollHistories } = srv.entities;

  // -----------------------------------------------------------------
  //  Block modifying or deleting history
  // -----------------------------------------------------------------
  srv.before(["UPDATE", "PATCH", "DELETE"], PayrollHistories, async (req) => {
    return req.error(
      400,
      "Audit Integrity Error: Payroll history records are immutable and cannot be updated or deleted.",
    );
  });
};
