namespace ewms.db.project;

using { managed } from '@sap/cds/common';


using {ewms.db.project.Project} from './project';
using {ewms.db.employee.Employee} from '../employee/employee';

entity ProjectManager : managed {
    key ID : UUID;
    project : Association to Project;
    employeeID : Association to Employee;
    fromDate : Date;
    toDate : Date;
    isActive : Boolean default true;
}
