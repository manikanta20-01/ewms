const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    require('./handlers/team')(this);
    require('./handlers/team-manager')(this);

});