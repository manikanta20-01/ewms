namespace ewms.db.common;
using { managed } from '@sap/cds/common';

entity LoginHistory : managed {
    key ID        : UUID;
    iasUserId     : String(255);
    loginTime     : Timestamp @cds.on.insert: $now;
    ipAddress     : String(45);
    userAgent     : String(255);
    success       : Boolean;
    failureReason : String(200);
}