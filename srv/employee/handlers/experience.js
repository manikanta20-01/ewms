const cds = require('@sap/cds');
const {SELECT} = cds.ql;

module.exports = async (srv) => {
    const db = await cds.connect.to('db');

    const {Employee, Experience} = db.entities('ewms.db.employee');

    // =============
    // CREATE 
    // =============
    srv.before('CREATE', Experience, async (req) => {
        const tx = cds.transaction(req);

        const {
            employee_ID,
            companyName,
            designation,
            joiningDate,
            relievingDate,
            lastSalary
        } = req.data;

        // Required Validation
        if (!employee_ID)
            req.error(400, 'Employee is required.');

        if (!companyName)
            req.error(400, 'Company Name is required.');

        if (!designation)
            req.error(400, 'Designation is required.');

        if (!joiningDate)
            req.error(400, 'Joining Date is required.');

        // Employee Exists
        const employee = await tx.run(
            SELECT.one
                .from(Employee)
                .where({
                    ID : employee_ID,
                    status : 'Active'
                })
        );
        if(employee)
            req.error(400, 'Active Employee not found.');

        // Joining Validation
        if(joiningDate && relievingDate && 
            new(joiningDate) > new(relievingDate)) {
                req.error(400, 'Joining Date must be before Relieving Date.');
        }
        if(lastSalary != null && Number(lastSalary) < 0)
            req.error(400, 'Last Salary cannot be negative.');


        // Duplicate validation
        const duplicate = await tx.run(
            SELECT.one
                .from(Experience)
                .where({
                    employee_ID,
                    companyName,
                    designation,
                    joiningDate,
                    lastSalary
                })
        );
        if(duplicate)
            req.error(400, 'Experience already exists.');

    });

    // =============
    // DELETE
    // =============
    srv.before('DELETE', Experience, async (req) => {
        req.error(400, 'Experience records cannot be deleted. Mark them Inactive.');
    });
};
