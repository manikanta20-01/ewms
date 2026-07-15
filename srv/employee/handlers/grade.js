const cds = require('@sap/cds');
const { SELECT } = cds;

module.exports = (srv) => {

    srv.before('CREATE', 'Grades', async (req) => {

        if (!req.data.name) {
            req.error(400, 'Grade name is required');
        }

        const tx = cds.transaction(req);

        const existing = await tx.run(
            cds.ql.SELECT.one
                .from('EmployeeService.Grades')
                .where({
                    name: req.data.name
                })
        );

        if (existing) {
            req.error(400, 'Grade already exists');
        }

    });

};