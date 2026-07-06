namespace ewms.db.employee;
using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from './employee';

entity Bank : managed {
    key ID : UUID;
    employee : Association to Employee not null;
    bankName : type.Name100;
    branchName : type.Name150;
    accountHolderName : type.Name100;
    accountNumber : String(30);
    accountType : enums.AccountType;
    currency : enums.CurrencyType;
    ifscCode : String(16);
    swiftCode : String(30);
    upiId : String(100);
    payrollAccount : Boolean default true;
    status : enums.Status default 'Active';
}

