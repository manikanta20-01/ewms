namespace ewms.db.organization;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

entity Company : managed {

    key ID : UUID;
    companyCode      : String(30);
    companyName      : type.Name100;
    registrationNo   : String(30);
    taxNumber        : String(30);
    website          : type.URL;
    email            : type.Email;
    phone            : type.Phone;
    currency         : type.CurrencyType;
    description      : type.Description;
    status           : enums.Status default 'Active';

}