namespace ewms.db.employee;
using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from './employee';

entity Education : managed {
    key ID : UUID;
    employee : Association to Employee NOT NULL;
    degree            : String(100);
    specialization    : String(100);
    institution       : String(150);
    boardUniversity   : String(150);
    passingYear       : Integer;
    percentage        : enums.Percentage;
    cgpa              : Decimal(4,2);
    grade             : String(10);
    country           : String(100);
    remarks           : enums.Description;  
    qualification : enums.QualificationType;

    status            : enums.Status default 'Active';

}
