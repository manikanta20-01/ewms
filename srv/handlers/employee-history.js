const cds = require('@sap/cds');

module.exports = (srv) => {

    srv.after('CREATE', 'EmployeeAssignments', async (data, req) => {

        const tx = cds.transaction(req);

        await tx.run(

            INSERT.into('EmployeeService.EmployeeHistory').entries({

                employee_ID: data.employee_ID,

                department_ID: data.department_ID,

                designation_ID: data.designation_ID,

                grade_ID: data.grade_ID,

                project_ID: data.project_ID,

                team_ID: data.team_ID,

                reportingManager_ID: data.reportingManager_ID,

                effectiveDate: new Date(),

                action: 'JOINED',

                remarks: 'Initial employee assignment'

            })

        );

    });

    srv.after('UPDATE', 'EmployeeAssignments', async (data, req) => {

    const tx = cds.transaction(req);

    await tx.run(

        INSERT.into('EmployeeService.EmployeeHistory').entries({

            employee_ID: data.employee_ID,

            department_ID: data.department_ID,

            designation_ID: data.designation_ID,

            grade_ID: data.grade_ID,

            effectiveDate: new Date(),

            action: 'TRANSFERRED',

            remarks: 'Assignment updated'

        })

    );

});

};