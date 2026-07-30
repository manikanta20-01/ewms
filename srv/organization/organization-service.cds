using { ewms.db.organization as db } from '../../db/schema';

service OrganizationService {

    @requires: [
        'SystemAdmin',
        'HRAdmin',
        'HRExecutive',
        'DepartmentManager',
        'ProjectManager',
        'FinanceManager',
        'PayrollExecutive',
        'Employee'
    ]
    entity Companies as projection on db.Company;

    @requires: [
        'SystemAdmin',
        'HRAdmin',
        'HRExecutive'
    ]
    entity BusinessUnits as projection on db.BusinessUnit;

    @requires: [
        'SystemAdmin',
        'HRAdmin',
        'HRExecutive'
    ]
    entity Departments as projection on db.Department;

    @requires: [
        'SystemAdmin',
        'HRAdmin',
        'HRExecutive'
    ]
    entity Locations as projection on db.Location;

    @requires: [
        'SystemAdmin',
        'HRAdmin'
    ]
    entity DepartmentHRs as projection on db.DepartmentHR;

}