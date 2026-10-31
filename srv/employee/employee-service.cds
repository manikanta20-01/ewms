using {ewms.db.employee as db} from '../../db/schema';

// ============================================================
// SPRINT 17 note - DOCUMENT ACTIONS
// ------------------------------------------------------------
// The Document entity keeps OData CRUD for metadata, but every
// STATE change is a dedicated bound action (same pattern as the
// timesheet / performance modules):
//
//   Verify(comments)   Pending -> Verified        (HRAdmin/SystemAdmin)
//   Reject(comments)   Pending -> Rejected        (HRAdmin/SystemAdmin,
//                      mandatory reason)
//   Archive()          Active  -> Archived        (HRAdmin/SystemAdmin)
//   Download()         returns the stored file (owner / HRAdmin /
//                      SystemAdmin) as base64 - the ONLY way bytes
//                      leave the system; the storage key is masked
//                      on all reads.
//
// Security lives in employee-security.cds; transitions are enforced
// in handlers/document.js with conditional updates.
// ============================================================

service EmployeeService {
    entity Employees as projection on db.Employee;
    entity Designations as projection on db.Designation;
    entity Grades as projection on db.Grade;
    entity EmployeeAssignments as projection on db.EmployeeAssignment;
    entity EmployeeHistory as projection on db.EmployeeHistory;
    entity Banks as projection on db.Bank;
    entity Educations as projection on db.Education;
    entity Experiences as projection on db.Experience;
    entity Documents as projection on db.Document actions {
        action Verify(comments : String(500)) returns String;
        action Reject(comments : String(500)) returns String;
        action Archive() returns String;
        // Structured result: metadata + base64 file content.
        action Download() returns {
            fileName : String(255);
            mimeType : String(100);
            fileSize : Integer;
            sha256   : String(64);
            content  : LargeBinary;
        };
    };
    entity StatutoryDetails as projection on db.StatutoryDetail;
}
