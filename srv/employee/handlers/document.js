const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

module.exports = async (srv) => {

    const db = await cds.connect.to('db');

    const {
        Employee,
        Document
    } = db.entities('ewms.db.employee');

    /**
     * CREATE
     */
    srv.before('CREATE', 'Documents', async (req) => {

        const tx = cds.transaction(req);

        const {
            employee_ID,
            documentType,
            documentNumber,
            fileName,
            mimeType,
            fileSize,
            expiryDate
        } = req.data;

        // Required Validation
        if (!employee_ID)
            req.error(400, 'Employee is required.');

        if (!documentType)
            req.error(400, 'Document Type is required.');

        if (!fileName)
            req.error(400, 'File Name is required.');

        if (!mimeType)
            req.error(400, 'Mime Type is required.');

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

        // Duplicate Document
        const duplicate = await tx.run(
            SELECT.one
                .from(Document)
                .where({
                    employee_ID,
                    documentType,
                    documentNumber
                })
        );

        if (duplicate)
            req.error(400, 'Document already exists.');

        // File Size (10 MB)
        if (fileSize && fileSize > 10485760)
            req.error(400, 'Maximum file size is 10 MB.');

        // Expiry Date
        if (expiryDate && new Date(expiryDate) < new Date()) {
            req.warn('Document expiry date has already passed.');
        }

        // Verification Defaults
        req.data.verified = false;
        req.data.verifiedBy = null;
        req.data.verifiedOn = null;
    });

    /**
     * UPDATE
     */
    srv.before('UPDATE', 'Documents', async (req) => {

        // Only HR can verify
        if (
            req.data.verified === true ||
            req.data.verifiedBy ||
            req.data.verifiedOn
        ) {

            if (!req.user.is('HR')) {
                req.error(403, 'Only HR can verify documents.');
            }

            req.data.verifiedBy = req.user.id;
            req.data.verifiedOn = new Date();
        }
    });

    /**
     * DELETE
     */
    srv.before('DELETE', 'Documents', async (req) => {

        req.error(
            400,
            'Documents cannot be deleted. Mark them Inactive.'
        );

    });

};