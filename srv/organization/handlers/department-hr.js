const cds = require('@sap/cds');
const { SELECT } = cds;

module.exports = (srv) => {

    srv.before('CREATE', 'DepartmentHR', async (req) => {

        if (!req.data.department_ID)
            req.error(400, 'Department is required.');

        if (!req.data.employee_ID)
            req.error(400, 'Employee is required.');

        const tx = cds.transaction(req);

        const exists = await tx.run(
            cds.ql.SELECT.one
                .from('OrganizationService.DepartmentHR')
                .where({
                    department_ID: req.data.department_ID,
                    isActive: true
                })
        );

        if (exists)
            req.error(400, 'Department already has an active HR.');

    });

};