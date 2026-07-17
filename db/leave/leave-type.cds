namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

entity LeaveType : managed {
    key ID : UUID;
    leaveCode : type.BusinessCode @assert.unique;
    name : type.Name100;
    description : type.Description;
    color : type.Name50;
    isPaid : Boolean default false;
    carryForward : Boolean default false;
    requiresDocument : Boolean default false;
    maxDaysPerRequest : Integer;
    status : enums.Status default 'Active';
}
