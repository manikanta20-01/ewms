const cds = require('@sap/cds');
const { SELECT } = cds;

async function exists(req, entity, id) {

    const tx = cds.transaction(req);

    const row = await tx.run(

        cds.ql.SELECT.one
            .from(entity)
            .where({
                ID: id
            })

    );

    return !!row;

}

module.exports = {

    exists

};