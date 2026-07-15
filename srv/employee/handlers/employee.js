const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const { employeeAge, futureJoining } = require('../../common/utils/business-rules');
const { validateDelete } = require('../../common/utils/delete-validator');

module.exports = (srv) => {

    /**
     * Create Employee
     */
    srv.before('CREATE', 'Employees', async (req) => {

        const tx = cds.transaction(req);

        // ==========================
        // Required Fields
        // ==========================
        if (!req.data.firstName)
            return req.error(400, 'First Name is required.');

        if (!req.data.lastName)
            return req.error(400, 'Last Name is required.');

        if (!req.data.email)
            return req.error(400, 'Email is required.');

        if (!req.data.joiningDate)
            return req.error(400, 'Joining Date is required.');

        // ==========================
        // Business Rules
        // ==========================
        employeeAge(req);
        futureJoining(req);

        // ==========================
        // Email Format Validation
        // ==========================
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(req.data.email)) {
            return req.error(400, 'Invalid email address.');
        }

        // ==========================
        // Duplicate Email Check
        // ==========================
        const existingEmail = await tx.run(
            SELECT.one
                .from('ewms.db.employee.Employee')
                .where({
                    email: req.data.email
                })
        );

        if (existingEmail) {
            return req.error(400, 'Employee email already exists.');
        }

        // ==========================
        // Duplicate Mobile Check
        // ==========================
        if (req.data.mobile) {

            const existingMobile = await tx.run(
                SELECT.one
                    .from('ewms.db.employee.Employee')
                    .where({
                        mobile: req.data.mobile
                    })
            );

            if (existingMobile) {
                return req.error(400, 'Mobile number already exists.');
            }
        }

        // ==========================
        // Auto Employee Code
        // ==========================
        if (!req.data.employeeCode) {

            const lastEmployee = await tx.run(
                SELECT.one
                    .from('ewms.db.employee.Employee')
                    .columns('employeeCode')
                    .orderBy('employeeCode desc')
            );

            let next = 1;

            if (lastEmployee?.employeeCode) {
                next =
                    parseInt(
                        lastEmployee.employeeCode.substring(3),
                        10
                    ) + 1;
            }

            req.data.employeeCode =
                'EMP' + String(next).padStart(6, '0');
        }

    });

    /**
     * Update Employee
     */
    srv.before('UPDATE', 'Employees', async (req) => {

        // Prevent changing employee code
        if (req.data.employeeCode) {
            delete req.data.employeeCode;
        }

    });

    /**
     * Delete Employee
     */
    srv.before('DELETE', 'Employees', async (req) => {

        await validateDelete(
            req,
            'ewms.db.employee.EmployeeAssignment',
            'employee_ID'
        );

    });

};