const { required } = require("../utils/validation");
const { generateCode } = require("../utils/code-generator");

module.exports = (srv) => {

    srv.before("CREATE", "BusinessUnits", async (req) => {

        required(req, "businessUnitName", "Business Unit");

        req.data.businessUnitCode =
            await generateCode(
                req,
                "OrganizationService.BusinessUnits",
                "businessUnitCode",
                "BU",
                4
            );

    });

};