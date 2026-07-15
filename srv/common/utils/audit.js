const cds = require('@sap/cds');

module.exports = (srv) => {

    const entities = Object.keys(srv.entities);

    entities.forEach(entity => {

        srv.after('CREATE', entity, async (data) => {

            console.log(`Created ${entity} : ${data.ID}`);

        });

        srv.after('UPDATE', entity, async (data) => {

            console.log(`Updated ${entity} : ${data.ID}`);

        });

        srv.after('DELETE', entity, async (data) => {

            console.log(`Deleted ${entity} : ${data.ID}`);

        });

    });

};