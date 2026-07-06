namespace ewms.db.organization;

using {managed} from '@sap/cds/common';
using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';
using {ewms.db.organization.Company} from './company';

entity BusinessUnit : managed {
    key ID : UUID;
    businessUnitCode : type.BusinessCode;
    businessUnitName : type.Name100;
    description : type.Description;
    company : Association to Company;
    status : enums.Status default 'Active';
}

