namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

entity Designation : managed {
    key ID : UUID;
    designationCode : type.BusinessCode;
    designationName : type.Name100;
    description : type.Description;
    status : enums.Status default 'Active';
}
