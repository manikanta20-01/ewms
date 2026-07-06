namespace ewms.db.team;

using { managed } from '@sap/cds/common';

using {ewms.db.team.Team} from './team';
using {ewms.db.employee.Employee} from '../employee/employee';

entity TeamManager : managed {
    key ID : UUID;
    team : Association to Team;
    employeeID : Association to Employee;
    fromDate : Date;
    toDate : Date;
    isActive : Boolean default true;
}
