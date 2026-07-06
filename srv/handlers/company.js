const cds = require("@sap/cds");
const { Company } = cds.entities("ewms.db.organization");

const { exists } = require("../utils/duplicate");

module.exports = srv => {

    srv.before("CREATE", "Companies", async req => {

        const tx = cds.transaction(req);

        const duplicate = await exists(

            tx,

            Company,

            {
                companyName: req.data.companyName
            }

        );

        if (duplicate)

            req.error(400, "Company already exists.");

    });

};