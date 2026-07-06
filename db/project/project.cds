namespace ewms.db.project;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';
using {ewms.db.organization.Department} from '../organization/department';

entity Project : managed {
    key ID : UUID;
    projectCode : type.BusinessCode;
    projectName : type.Name100;
    clientName : type.Name100;
    description : type.Description;
    department : Association to Department;
    plannedStartDate : Date;
    plannedEndDate : Date;
    actualStartDate : Date;
    actualEndDate : Date;
    budget : type.Amount;
    status : enums.Status default 'Active';
}

