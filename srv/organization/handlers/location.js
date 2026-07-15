const { required } = require("../../common/utils/validation");
const { generateCode } = require("../../common/utils/code-generator");

module.exports = (srv) => {

    srv.before("CREATE", "Locations", async (req) => {

        required(req, "locationName", "Location Name");

        req.data.locationCode =
            await generateCode(
                req,
                "OrganizationService.Locations",
                "locationCode",
                "LOC",
                4
            );

    });

};