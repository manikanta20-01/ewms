const { required } = require("../utils/validation");
const { generateCode } = require("../utils/code-generator");

module.exports = (srv) => {

    srv.before("CREATE", "Teams", async (req) => {

        required(req, "teamName", "Team Name");

        req.data.teamCode =
            await generateCode(
                req,
                "TeamService.Teams",
                "teamCode",
                "TEAM",
                4
            );

    });

};