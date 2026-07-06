const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    require('./handlers/project')(this);
    require('./handlers/project-manager')(this);

});