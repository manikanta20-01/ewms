namespace ewms.db.common;

using {managed} from '@sap/cds/common';

entity AuditLog : managed {
    key ID : UUID;
    user : String(100);
    action : String(50);
    entityName : String(100);
    oldName : LargeString;
    newName : LargeString;
}