const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");
const { startBeforeEnd } = require("../../common/utils/date-validation");

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