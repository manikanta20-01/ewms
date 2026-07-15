const cds = require('@sap/cds');
const { SELECT } = cds.ql;

async function exists(req, entity, where) {

    const tx = cds.transaction(req);

    return tx.run(
        SELECT.one
            .from(entity)
            .where(where)
    );
}

module.exports = {
    exists
};