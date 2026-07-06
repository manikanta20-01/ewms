const { required } = require("../utils/validation");
const { generateCode } = require("../utils/code-generator");

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