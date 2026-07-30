const Roles = require('./roles');

module.exports = Object.freeze({
    HR: [
        Roles.HR_ADMIN,
        Roles.HR_EXECUTIVE
    ],
    PAYROLL: [
        Roles.PAYROLL_EXECUTIVE,
        Roles.FINANCE_MANAGER
    ],
    MANAGEMENT: [
        Roles.DEPARTMENT_MANAGER,
        Roles.PROJECT_MANAGER
    ],
    EMPLOYEE_SELF: [
        Roles.EMPLOYEE
    ]
});