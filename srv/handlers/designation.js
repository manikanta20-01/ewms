const cds = require('@sap/cds');
const { SELECT } = cds;

module.exports = (srv) => {

    srv.before('CREATE', 'Designations', async (req) => {

        if (!req.data.designationName) {
            req.error(400, 'Designation name is required');
        }

        const tx = cds.transaction(req);

        const existing = await tx.run(
            cds.ql.SELECT.one
                .from('EmployeeService.Designations')
                .where({
                    designationName: req.data.designationName
                })
        );

        if (existing) {
            req.error(400, 'Designation already exists');
        }

    });

};