const cds = require('@sap/cds');
const { SELECT } = cds.ql;

module.exports = async (srv) => {

    const db = await cds.connect.to('db');

    const {
        Employee,
        StatutoryDetail
    } = db.entities('ewms.db.employee');

    /**
     * CREATE
     */
    srv.before('CREATE', 'StatutoryDetails', async (req) => {

        const tx = cds.transaction(req);

        const {
            employee_ID,
            panNumber,
            aadhaarNumber,
            uanNumber,
            pfNumber,
            esiNumber,
            passportNumber,
            passportExpiry,
            isPFApplicable,
            isESIApplicable
        } = req.data;

        // Required

        if (!employee_ID)
            req.error(400, 'Employee is required.');

        // Employee Exists

        const employee = await tx.run(

            SELECT.one
                .from(Employee)
                .where({
                    ID: employee_ID,
                    status: 'Active'
                })

        );

        if (!employee)
            req.error(404, 'Employee not found.');

        // One Record Per Employee

        const existing = await tx.run(

            SELECT.one
                .from(StatutoryDetail)
                .where({
                    employee_ID
                })

        );

        if (existing)
            req.error(
                400,
                'Statutory Details already exist for this employee.'
            );

        // PAN Validation

        if (
            panNumber &&
            !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)
        ) {

            req.error(
                400,
                'Invalid PAN Number.'
            );

        }

        // Aadhaar Validation

        if (
            aadhaarNumber &&
            !/^[0-9]{12}$/.test(aadhaarNumber)
        ) {

            req.error(
                400,
                'Invalid Aadhaar Number.'
            );

        }

        // PF Validation

        if (isPFApplicable && !pfNumber) {

            req.error(
                400,
                'PF Number is required.'
            );

        }

        // UAN Validation

        if (isPFApplicable && !uanNumber) {

            req.error(
                400,
                'UAN Number is required.'
            );

        }

        // ESI Validation

        if (isESIApplicable && !esiNumber) {

            req.error(
                400,
                'ESI Number is required.'
            );

        }

        // Passport Expiry

        if (
            passportNumber &&
            !passportExpiry
        ) {

            req.error(
                400,
                'Passport Expiry Date is required.'
            );

        }

        if (
            passportExpiry &&
            new Date(passportExpiry) < new Date()
        ) {

            req.warn(
                'Passport has already expired.'
            );

        }

    });

    /**
     * UPDATE
     */
    srv.before('UPDATE', 'StatutoryDetails', async (req) => {

        if (
            req.data.panNumber &&
            !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(req.data.panNumber)
        ) {

            req.error(
                400,
                'Invalid PAN Number.'
            );

        }

        if (
            req.data.aadhaarNumber &&
            !/^[0-9]{12}$/.test(req.data.aadhaarNumber)
        ) {

            req.error(
                400,
                'Invalid Aadhaar Number.'
            );

        }

    });

    /**
     * DELETE
     */
    srv.before('DELETE', 'StatutoryDetails', async (req) => {

        req.error(
            400,
            'Statutory Details cannot be deleted. Mark them Inactive.'
        );

    });

};