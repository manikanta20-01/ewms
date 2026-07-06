const { required } = require("../utils/validation");
const { generateCode } = require("../utils/code-generator");
const { startBeforeEnd } = require("../utils/date-validation");

module.exports = (srv) => {

    srv.before("CREATE", "Projects", async (req) => {

        required(req, "projectName", "Project Name");

        startBeforeEnd(
            req,
            "plannedStartDate",
            "plannedEndDate"
        );

        req.data.projectCode =
            await generateCode(
                req,
                "ProjectService.Projects",
                "projectCode",
                "PROJ",
                4
            );

    });

};