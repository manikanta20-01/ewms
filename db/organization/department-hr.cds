namespace ewms.db.organization;

using {managed} from '@sap/cds/common';

using {ewms.db.organization.Department} from './department';
using {ewms.db.employee.Employee} from '../employee/employee';

entity DepartmentHR : managed {
    key ID : UUID;
    department : Association to Department;
    employee : Association to Employee;
    fromDate : Date;
    toDate : Date;
    isActive : Boolean default true;    
}
