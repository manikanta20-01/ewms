using { ewms.db.organization as db } from '../../db/schema';

service OrganizationService {
    entity Companies as projection on db.Company;
    entity BusinessUnits as projection on db.BusinessUnit;
    entity Departments as projection on db.Department;
    entity Locations as projection on db.Location;
    entity DepartmentHRs as projection on db.DepartmentHR;
}

