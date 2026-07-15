
const cds = require('@sap/cds');
const { SELECT } = cds;

/**
 * Generate sequential business codes
 *
 * Example:
 * COMP0001
 * EMP000001
 * PROJ0001
 */

async function generateCode(req, entity, field, prefix, length) {

    const tx = cds.transaction(req);

    const lastRecord = await tx.run(
        cds.ql.SELECT.one
            .from(entity)
            .columns(field)
            .orderBy({ [field]: 'desc' })
    );

    let nextNumber = 1;

    if (lastRecord && lastRecord[field]) {

        const lastCode = lastRecord[field];

        nextNumber =
            parseInt(lastCode.replace(prefix, ''), 10) + 1;

    }

    return prefix + String(nextNumber).padStart(length, '0');

}

module.exports = {
    generateCode
};