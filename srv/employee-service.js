const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
    require('./handlers/employee')(this);
    require('./handlers/designation')(this);
    require('./handlers/grade')(this);
    require('./handlers/employee-assignment')(this);
    require('./handlers/bank')(this);
    require('./handlers/education')(this);
    require('./handlers/experience')(this);
    require('./handlers/document')(this);
    require('./handlers/statutory-detail')(this);
});

