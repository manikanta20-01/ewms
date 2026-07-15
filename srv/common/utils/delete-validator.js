const cds = require('@sap/cds');
const { SELECT } = cds.ql;

async function validateDelete(req, entity, field) {

    const tx = cds.transaction(req);

    const record = await tx.run(
        SELECT.one
            .from(entity)
            .where({
                [field]: req.data.ID
            })
    );

    if (record) {
        req.error(
            400,
            'Cannot delete because dependent records exist.'
        );
    }
}

module.exports = {
    validateDelete
};