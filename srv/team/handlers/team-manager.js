const cds = require('@sap/cds');
const { SELECT } = cds;

module.exports = (srv) => {

    srv.before('CREATE', 'TeamManagers', async (req) => {

        if (!req.data.team_ID)
            req.error(400, 'Team is required.');

        if (!req.data.employeeID_ID)
            req.error(400, 'Employee is required.');

        const tx = cds.transaction(req);

        const exists = await tx.run(
            cds.ql.SELECT.one
                .from('TeamService.TeamManagers')
                .where({
                    team_ID: req.data.team_ID,
                    isActive: true
                })
        );

        if (exists)
            req.error(400, 'Team already has an active manager.');

    });

};