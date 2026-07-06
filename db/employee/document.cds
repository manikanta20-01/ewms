namespace ewms.db.employee;
using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Employee} from './employee';

entity Document : managed {
    key ID : UUID;
    employee : Association to Employee not null;
    documentType : enums.DocumentType;
    documentNumber : String(100);
    fileName : String(255);
    mimeType : String(100);
    fileSize : Integer;
    filePath : String(500);
    expiryDate : Date;
    verified : Boolean default false;
    verifiedBy : String(100);
    verifiedOn : Timestamp;
    remarks : String(500);
    status : enums.Status default 'Active';
}

