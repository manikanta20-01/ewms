const cds = require('@sap/cds');
const { SELECT } = cds;

module.exports = (srv) => {

    srv.before('CREATE', 'ProjectManagers', async (req) => {

        if (!req.data.project_ID)
            req.error(400, 'Project is required.');

        if (!req.data.employeeID_ID)
            req.error(400, 'Employee is required.');

        const tx = cds.transaction(req);

        const exists = await tx.run(
            cds.ql.SELECT.one
                .from('ProjectService.ProjectManagers')
                .where({
                    project_ID: req.data.project_ID,
                    isActive: true
                })
        );

        if (exists)
            req.error(400, 'Project already has an active manager.');

    });

};