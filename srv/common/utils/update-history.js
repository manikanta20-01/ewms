const cds = require('@sap/cds');

module.exports = async function(req, oldData, newData) {

    const tx = cds.transaction(req);

    if (
        oldData.designation_ID !== newData.designation_ID ||
        oldData.grade_ID !== newData.grade_ID
    ) {

        await tx.run(

            INSERT.into('EmployeeService.EmployeeHistory')
                .entries({

                    employee_ID: newData.employee_ID,

                    designation_ID: newData.designation_ID,

                    grade_ID: newData.grade_ID,

                    effectiveDate: new Date(),

                    action: 'PROMOTION',

                    remarks: 'Assignment Updated'

                })

        );

    }

};