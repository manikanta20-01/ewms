const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

module.exports = async (srv) => {

    const db = await cds.connect.to('db');

    const {
        Employee,
        Bank
    } = db.entities('ewms.db.employee');

    /**
     * CREATE
     */
    srv.before('CREATE', 'Banks', async (req) => {

        const tx = cds.transaction(req);

        const {
            employee_ID,
            bankName,
            accountHolderName,
            accountNumber,
            ifscCode
        } = req.data;

        // ==========================
        // Mandatory Fields
        // ==========================

        if (!employee_ID)
            req.error(400, 'Employee is required.');

        if (!bankName)
            req.error(400, 'Bank Name is required.');

        if (!accountHolderName)
            req.error(400, 'Account Holder Name is required.');

        if (!accountNumber)
            req.error(400, 'Account Number is required.');

        if (!ifscCode)
            req.error(400, 'IFSC Code is required.');

        // ==========================
        // Employee Exists
        // ==========================

        const employee = await tx.run(

            SELECT.one
                .from(Employee)
                .where({
                    ID: employee_ID
                })

        );

        if (!employee)
            req.error(404, 'Employee not found.');

        // ==========================
        // Duplicate Account
        // ==========================

        const duplicate = await tx.run(

            SELECT.one
                .from(Bank)
                .where({

                    employee_ID,

                    accountNumber

                })

        );

        if (duplicate)
            req.error(
                400,
                'Bank account already exists.'
            );

        // ==========================
        // Existing Payroll Account
        // ==========================

        const currentPayroll = await tx.run(

            SELECT.one
                .from(Bank)
                .where({

                    employee_ID,

                    payrollAccount: true,

                    status: 'Active'

                })

        );

        if (!currentPayroll) {

            req.data.payrollAccount = true;

        } else {

            req.data.payrollAccount = true;

            await tx.run(

                UPDATE(Bank)

                    .set({

                        payrollAccount: false,

                        status: 'Inactive'

                    })

                    .where({

                        ID: currentPayroll.ID

                    })

            );

        }

    });

    /**
     * UPDATE
     */
    srv.before('UPDATE', 'Banks', async (req) => {

        const tx = cds.transaction(req);

        // ==========================
        // Current Bank Record
        // ==========================

        const currentBank = await tx.run(

            SELECT.one
                .from(Bank)
                .where({
                    ID: req.data.ID
                })

        );

        if (!currentBank)
            req.error(404, 'Bank account not found.');

        // Values after update

        const employee_ID =
            currentBank.employee_ID;

        const accountNumber =
            req.data.accountNumber ?? currentBank.accountNumber;

        const payrollAccount =
            req.data.payrollAccount ?? currentBank.payrollAccount;

        // ==========================
        // Duplicate Account Number
        // ==========================

        const duplicate = await tx.run(

            SELECT.one
                .from(Bank)
                .where({

                    employee_ID,

                    accountNumber,

                    ID: {
                        '!=': currentBank.ID
                    }

                })

        );

        if (duplicate)
            req.error(
                400,
                'Bank account already exists.'
            );

        // ==========================
        // Payroll Account Change
        // ==========================

        if (payrollAccount === true) {

            const currentPayroll = await tx.run(

                SELECT.one
                    .from(Bank)
                    .where({

                        employee_ID,

                        payrollAccount: true,

                        status: 'Active'

                    })

            );

            if (
                currentPayroll &&
                currentPayroll.ID !== currentBank.ID
            ) {

                await tx.run(

                    UPDATE(Bank)

                        .set({

                            payrollAccount: false,

                            status: 'Inactive'

                        })

                        .where({

                            ID: currentPayroll.ID

                        })

                );

            }

        }

    });

    /**
     * DELETE
     */
    srv.before('DELETE', 'Banks', async (req) => {

        req.error(

            400,

            'Bank accounts cannot be deleted. Mark them Inactive or add a new Payroll Account.'

        );

    });

};