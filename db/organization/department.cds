namespace ewms.db.organization;

using {managed} from '@sap/cds/common';
using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.organization.Location} from './location';
using {ewms.db.organization.BusinessUnit} from './business-unit';

entity Department : managed {
    key ID : UUID;
    departmentCode : type.BusinessCode;
    departmentName : type.Name100;
    description : type.Description;
    businessUnit : Association to BusinessUnit;
    location : Association to Location;
    status : enums.Status;
}
