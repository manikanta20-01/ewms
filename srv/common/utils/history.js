const cds = require('@sap/cds');

module.exports = async function (
    req,
    entity,
    data
) {

    const tx = cds.transaction(req);

    await tx.run(

        INSERT.into(entity).entries(data)

    );

};