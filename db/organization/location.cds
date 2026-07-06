namespace ewms.db.organization;

using {managed} from '@sap/cds/common';
using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';
using {ewms.db.organization.BusinessUnit} from './business-unit';

entity Location : managed {
    key ID : UUID;
    locationCode : type.BusinessCode;
    locationName : type.Name100;
    city : type.City;
    state : type.State;
    country : type.Country;
    timeZone : type.TimeZone;
    status : enums.Status;
    postalCode : type.PostalCode;
    businessUnit : Association to BusinessUnit;
    
}