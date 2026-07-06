const cds = require('@sap/cds');
const { SELECT } = cds.ql;

module.exports = async (srv) => {

    const db = await cds.connect.to('db');

    const {
        Employee,
        Education
    } = db.entities('ewms.db.employee');

    /**
     * CREATE
     */
    srv.before('CREATE', 'Educations', async (req) => {

        const tx = cds.transaction(req);

        const {
            employee_ID,
            qualification,
            degree,
            institution,
            passingYear,
            percentage,
            cgpa
        } = req.data;

        // ==========================
        // Mandatory Fields
        // ==========================

        if (!employee_ID)
            req.error(400, 'Employee is required.');

        if (!qualification)
            req.error(400, 'Qualification is required.');

        if (!degree)
            req.error(400, 'Degree is required.');

        if (!institution)
            req.error(400, 'Institution is required.');

        if (!passingYear)
            req.error(400, 'Passing Year is required.');

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
        // Passing Year Validation
        // ==========================

        const currentYear = new Date().getFullYear();

        if (passingYear > currentYear)
            req.error(
                400,
                'Passing Year cannot be in the future.'
            );

        // ==========================
        // Percentage Validation
        // ==========================

        if (
            percentage != null &&
            (percentage < 0 || percentage > 100)
        ) {
            req.error(
                400,
                'Percentage must be between 0 and 100.'
            );
        }

        // ==========================
        // CGPA Validation
        // ==========================

        if (
            cgpa != null &&
            (cgpa < 0 || cgpa > 10)
        ) {
            req.error(
                400,
                'CGPA must be between 0 and 10.'
            );
        }

        // ==========================
        // Duplicate Education
        // ==========================

        const duplicate = await tx.run(

            SELECT.one
                .from(Education)
                .where({

                    employee_ID,

                    qualification,

                    degree,

                    institution,

                    passingYear

                })

        );

        if (duplicate)
            req.error(
                400,
                'Education record already exists.'
            );

    });

    /**
     * UPDATE
     */
    srv.before('UPDATE', 'Educations', async (req) => {

        const tx = cds.transaction(req);

        const current = await tx.run(

            SELECT.one
                .from(Education)
                .where({
                    ID: req.data.ID
                })

        );

        if (!current)
            req.error(404, 'Education record not found.');

        const passingYear =
            req.data.passingYear ?? current.passingYear;

        const percentage =
            req.data.percentage ?? current.percentage;

        const cgpa =
            req.data.cgpa ?? current.cgpa;

        const qualification =
            req.data.qualification ?? current.qualification;

        const degree =
            req.data.degree ?? current.degree;

        const institution =
            req.data.institution ?? current.institution;

        // ==========================
        // Passing Year Validation
        // ==========================

        const currentYear = new Date().getFullYear();

        if (passingYear > currentYear)
            req.error(
                400,
                'Passing Year cannot be in the future.'
            );

        // ==========================
        // Percentage Validation
        // ==========================

        if (
            percentage != null &&
            (percentage < 0 || percentage > 100)
        ) {
            req.error(
                400,
                'Percentage must be between 0 and 100.'
            );
        }

        // ==========================
        // CGPA Validation
        // ==========================

        if (
            cgpa != null &&
            (cgpa < 0 || cgpa > 10)
        ) {
            req.error(
                400,
                'CGPA must be between 0 and 10.'
            );
        }

        // ==========================
        // Duplicate Education
        // ==========================

        const duplicate = await tx.run(

            SELECT.one
                .from(Education)
                .where({

                    employee_ID: current.employee_ID,

                    qualification,

                    degree,

                    institution,

                    passingYear,

                    ID: {
                        '!=': current.ID
                    }

                })

        );

        if (duplicate)
            req.error(
                400,
                'Another education record already exists.'
            );

    });

    /**
     * DELETE
     */
    srv.before('DELETE', 'Educations', async (req) => {

        req.error(
            400,
            'Education records cannot be deleted. Mark them Inactive.'
        );

    });

};