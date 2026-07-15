const cds = require('@sap/cds');
const { SELECT } = cds;

async function validateStatus(req, entity, idField, idValue) {

    const tx = cds.transaction(req);

    const row = await tx.run(

        cds.ql.SELECT.one
            .from(entity)
            .where({
                ID: idValue,
                status: 'Active'
            })

    );

    if (!row) {

        req.error(
            400,
            `${entity} is inactive or does not exist.`
        );

    }

}

module.exports = {

    validateStatus

};