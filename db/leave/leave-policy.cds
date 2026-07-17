namespace ewms.db.leave;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';
using ewms.db.organization.Company from '../organization/company';
using ewms.db.organization.BusinessUnit from '../organization/business-unit';
using {ewms.db.leave.LeaveType} from './leave-type';


entity LeavePolicy : managed {
    key ID : UUID;
    company : Association to Company;
    businessUnit : Association to BusinessUnit;
    leaveType : Association to LeaveType;
    daysPerYear : Decimal(5, 2);
    carryForwardLimit : Decimal(5, 2);
    maxContinuousDays : Decimal(5, 2);
    minNoticeDays : Integer;
    status : enums.Status default 'Active';
}
