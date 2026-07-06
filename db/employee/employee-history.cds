namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using {ewms.db.employee.Employee} from './employee';
using {ewms.db.organization.Department} from '../organization/department';
using {ewms.db.employee.Designation} from './designation';
using {ewms.db.employee.Grade} from './grade';
using {ewms.db.project.Project} from '../project/project';
using {ewms.db.team.Team} from '../team/team';


entity EmployeeHistory : managed {

    key ID : UUID;

    employee : Association to Employee not null;

    department : Association to Department;

    designation : Association to Designation;

    grade : Association to Grade;

    project : Association to Project;

    team : Association to Team;

    reportingManager : Association to Employee;

    effectiveDate : Date not null;

    action : String(30);

    remarks : String(500);

}