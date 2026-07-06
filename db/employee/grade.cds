namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

entity Grade : managed {
    key ID : UUID;
    gradeCode : type.BusinessCode;
    gradeName : type.Name100;
    description : type.Description;
    status : enums.Status default 'Active';
}
