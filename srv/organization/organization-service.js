const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    require('./handlers/company')(this);
    require('./handlers/business-unit')(this);
    require('./handlers/location')(this);
    require('./handlers/department')(this);
    require('./handlers/department-hr')(this);

});