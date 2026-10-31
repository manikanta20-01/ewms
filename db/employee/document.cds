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

    // ========================================================
    // SPRINT 17 - Documents & Compliance (in-place extension)
    // --------------------------------------------------------
    // The verification workflow (Pending -> Verified/Rejected)
    // and the document row lifecycle (Active/Archived/Replaced)
    // are enforced in srv/employee/handlers/document.js and under
    // srv/compliance/. Beginner summary:
    //
    //   * content      upload-only field (@cds.persistence.skip =
    //                  NOT a database column). The handler validates
    //                  the bytes (magic signature, size, filename)
    //                  and writes them into the private document
    //                  store; only `filePath` (a storage key) and
    //                  the real detected mimeType are kept.
    //   * sha256       integrity fingerprint of the stored bytes.
    //   * issueDate    when the authority issued the document.
    //   * verificationStatus  Pending/Verified/Rejected (HR work).
    //   * verificationNotes   HR comments on verify/reject.
    // ========================================================
    content : LargeBinary @cds.persistence.skip;
    sha256 : String(64);
    issueDate : Date;

    verificationStatus : enums.DocumentVerificationStatus default 'Pending';
    verificationNotes : String(500);
    status : enums.DocumentStatus default 'Active';
}
