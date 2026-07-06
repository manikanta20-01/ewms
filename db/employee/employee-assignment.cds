namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using {ewms.db.employee.Employee} from './employee';
using {ewms.db.project.Project} from '../project/project';
using {ewms.db.team.Team} from '../team/team';
using {ewms.db.employee.Designation} from './designation';
using {ewms.db.employee.Grade} from './grade';

entity EmployeeAssignment : managed {
    key ID : UUID;
    employee : Association to Employee;
    project : Association to Project;
    team : Association to Team;
    designation : Association to Designation;
    grade : Association to Grade;
    reportingManager : Association to Employee;
    fromDate : Date;
    toDate : Date;
    isActive : Boolean default true;   
}
