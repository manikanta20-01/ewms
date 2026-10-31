namespace ewms.db.hr_policy;

using { managed } from '@sap/cds/common';

using ewms.db.common as enums from '../common/enums';
using ewms.db.common as type from '../common/types';

using { ewms.db.employee.Employee } from '../employee/employee';
using { ewms.db.organization.Department } from '../organization/department';
using { ewms.db.organization.Company } from '../organization/company';

// ============================================================
// SPRINT 19 - HR POLICY MANAGEMENT
// ------------------------------------------------------------
// Backend-only module built on the EXISTING Employee and
// Organization models - no new master data, no duplicate
// document storage. Beginner summary of the structure:
//
//   * Policy        - the stable IDENTITY of a policy (code,
//                     title, category, owner, applicability).
//                     It has NO lifecycle status of its own:
//                     the lifecycle lives on the versions.
//   * PolicyVersion - one editable revision. EVERY version has
//                     its own lifecycle state, so publishing
//                     version 2 can never silently overwrite
//                     version 1 and the acknowledgments that
//                     point to it.
//   * PolicyAcknowledgment - one employee x one version, ONE
//                     row (duplicate-safe). Older versions'
//                     acknowledgments are preserved untouched
//                     when a new version is published.
//
// Version lifecycle (enforced in srv/hr-policy/handlers - the
// annotations here are vocabulary only):
//
//   Draft -> InReview -> Approved -> Published -> Superseded
//                \\-> Reject sends it back to Draft
//   Published -> Withdrawn -> Archived
//
// Applicability is CONFIGURABLE, never hardcoded law: company,
// country, department and employment type may all be null
// (= applies to everyone) or set to a concrete scope.
// Employee -> department/company resolution rides on the
// EXISTING EmployeeHistory -> Department -> BusinessUnit ->
// Company chain (see handlers/policy-common.js).
// ============================================================

entity Policy : managed {
    key ID : UUID;

    // Caller-supplied, HR-enforced unique code ("POL-CONDUCT").
    policyCode : String(20) not null;

    title       : String(150) not null;
    description : String(1000);

    category : enums.PolicyCategory not null;

    // Responsible people/org for the content (business owner;
    // may author and edit their own Draft versions too).
    owner            : Association to Employee not null;
    owningDepartment : Association to Department;

    // Applicability scope. null = no restriction on that axis.
    // These fields freeze once a version leaves Draft state
    // (handler rule) - re-scoping a published policy requires a
    // new version, exactly like re-wording it.
    applicableCompany        : Association to Company;
    applicableCountry        : type.Country;
    applicableDepartment     : Association to Department;
    applicableEmploymentType : enums.EmploymentType;

    // INFORMATIONAL policies can be disabled from the
    // acknowledgment workflow entirely (outstanding reports and
    // reminders then ignore them by rule).
    requiresAcknowledgment : Boolean default true;

    // Fixed confirmation sentence the employee accepts; a safe
    // default text is stamped by the create handler when unset.
    // The exact accepted sentence is COPIED onto each
    // acknowledgment row for evidence.
    acknowledgmentStatement : String(500);

    versions : Composition of many PolicyVersion
        on versions.policy = $self;
}

entity PolicyVersion : managed {
    key ID : UUID;

    policy    : Association to Policy not null;

    // Assigned by the server (highest existing + 1). The client
    // can never pick a version number.
    versionNo : Integer not null;

    // The content. At least ONE of the two is required
    // (validated on CreateVersion): full text stored in
    // `content`, or a reference/locator in `contentReference`.
    // NOTE: Sprint 17's binary document store is deliberately
    // NOT reused here - it is employee-scoped by design
    // (Document.employee is NOT NULL) and repurposing it would
    // refactor a completed sprint. See SPRINT-19.md.
    content          : LargeString;
    contentReference : String(500);

    status : enums.PolicyVersionStatus default 'Draft';

    // Review trail (separation of duties: the approver may not
    // be the person who submitted - handler rule).
    submittedBy : Association to Employee;
    submittedOn : Timestamp;
    decidedBy   : Association to Employee;
    decidedOn   : Timestamp;
    reviewComments : String(500);

    // Publication trail.
    publishedBy : Association to Employee;
    publishedOn : Timestamp;

    // Effectivity window of THIS version; effectiveDate is set
    // at version creation (validated not in the past) so the
    // outstanding-acknowledgment math can use it directly.
    effectiveDate : Date not null;
    expiryDate    : Date;
    reviewDate    : Date;   // scheduled periodic review, informational + reminder source

    // Withdrawal (removal of a published policy).
    withdrawalReason : String(500);
    withdrawnBy      : Association to Employee;
    withdrawnOn      : Timestamp;

    // Idempotency token for CreateVersion retries: the SAME
    // token never creates a second version (safe retries).
    clientRequestId : String(100);
}

entity PolicyAcknowledgment : managed {
    key ID : UUID;

    employee      : Association to Employee not null;
    policyVersion : Association to PolicyVersion not null;

    // Server-set at the Acknowledge action; payload is ignored.
    acknowledgedOn : Timestamp;

    // Evidence: the fixed sentence the employee accepted (copied
    // from the policy at ack time) plus an optional free-text
    // confirmation note. A record is IMMUTABLE after creation.
    acknowledgedStatement : String(2000);
    evidenceNote          : String(255);
}
