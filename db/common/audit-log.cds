namespace ewms.db.common;

using {managed} from '@sap/cds/common';

entity AuditLog : managed {
    key ID : UUID;
    user         : String(100);
    employeeId   : UUID;
    departmentId : UUID;
    roles        : LargeString;
    correlationId: String(100);
    action       : String(50);
    entity       : String(100);
    oldName      : LargeString;
    newName      : LargeString;
}