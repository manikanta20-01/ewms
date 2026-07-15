const cds = require("@sap/cds");
const { exists } = require("../../common/utils/check-reference");
const updateHistory = require("../../common/utils/update-history");

module.exports = (srv) => {

    srv.before(["CREATE", "UPDATE"], "EmployeeAssignments", async (req) => {

        if (!(await exists(
            req,
            "EmployeeService.Employees",
            req.data.employee_ID
        ))) {
            req.error(400, "Employee does not exist.");
        }

        if (!(await exists(
            req,
            "EmployeeService.Designations",
            req.data.designation_ID
        ))) {
            req.error(400, "Designation does not exist.");
        }

        if (!(await exists(
            req,
            "EmployeeService.Grades",
            req.data.grade_ID
        ))) {
            req.error(400, "Grade does not exist.");
        }

    });

    srv.before("UPDATE", "EmployeeAssignments", async (req) => {

        const tx = cds.transaction(req);

        const oldData = await tx.read(
            "EmployeeService.EmployeeAssignments",
            req.data.ID
        );

        await updateHistory(req, oldData, req.data);

    });

};