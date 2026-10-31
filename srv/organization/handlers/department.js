const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");
const { validateDelete } = require("../../common/utils/delete-validator");

module.exports = (srv) => {

    srv.before("CREATE", "Departments", async (req) => {

        required(req, "departmentName", "Department");

        req.data.departmentCode =
            await generateCode(
                req,
                "OrganizationService.Departments",
                "departmentCode",
                "DEP",
                4
            );

    });

    srv.before('DELETE', 'Departments', async (req) => {

        await validateDelete(
            req,
            'EmployeeService.EmployeeAssignments',
            'department_ID'
        );

    });

};