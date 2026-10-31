using { ewms.db.compliance as db } from '../../db/schema';
using { ewms.db.employee as emp } from '../../db/schema';

// ============================================================
// SPRINT 17 - DOCUMENTS & COMPLIANCE (SERVICE)
// ------------------------------------------------------------
// Three concerns, one service - none of them duplicate the
// Document entity (documents remain EmployeeService.Documents):
//
//   1. DocumentRequirements - the configurable rule catalog
//      ("who must what"). CRUD is admin work; everyone may read.
//
//   2. ComplianceSummaries / ComplianceLines - COMPUTED views
//      over employee x requirement x document. They are
//      @cds.persistence.skip entities: no tables, every READ
//      recomputes live status, so the result can never go stale
//      (a document verified this second counts immediately).
//
//   3. NotifyDocumentExpiries - manual reminder trigger. The repo
//      has NO background scheduler yet; the action is explicitly
//      designed to be safe to call (and re-call) from a cron job
//      or BTP job task - identical runs emit no duplicate
//      notifications (dedupe by recipient + document + title).
// ============================================================

service ComplianceService @(requires: 'authenticated-user') {

    entity DocumentRequirements as projection on db.DocumentRequirement;

    // Computed, NOT persisted (custom READ handlers in handlers/summaries.js).
    entity ComplianceSummaries @(cds.persistence.skip) {
        key employee_ID : UUID;
        employeeCode : String(20);
        firstName : String(100);
        lastName : String(100);
        employmentType : String(20);
        totalRequirements : Integer;
        mandatoryRequirements : Integer;
        compliant : Integer;
        expiring : Integer;
        expired : Integer;
        missing : Integer;
        pendingVerification : Integer;
        rejected : Integer;
        status : String enum { Compliant; Incomplete; Overdue; };
    };

    // Per-requirement detail rows for drill-down.
    entity ComplianceLines @(
        title: 'Compliance lines'
    ) @(cds.persistence.skip) {
        key employee_ID : UUID;
        key requirement_ID : UUID;
        requirementCode : String(20);
        requirementName : String(100);
        documentType : String(50);
        isMandatory : Boolean;
        lineStatus : String enum { Compliant; Expiring; Expired; Missing; Pending; Rejected; };
        document_ID : UUID;
        documentExpiryDate : Date;
        note : String(255);
    };

    // Manual trigger for compliance reminder notifications.
    // No scheduler exists in this repository: the action is
    // idempotent per notification period and can be invoked by an
    // external cron / BTP job (documented in SPRINT-17.md §6).
    action NotifyDocumentExpiries(daysBefore : Integer) returns String;
}
