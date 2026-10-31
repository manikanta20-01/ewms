namespace ewms.db.compliance;

using { managed } from '@sap/cds/common';
using ewms.db.common as enums from '../common/enums';
using {ewms.db.organization.BusinessUnit} from '../organization/business-unit';

// ============================================================
// SPRINT 17 - DOCUMENTS & COMPLIANCE (CONFIGURATION)
// ------------------------------------------------------------
// This module contains the CONFIGURATION + COMPUTED side of
// document compliance. The documents themselves stay in the
// employee domain (db/employee/document.cds) - this module only
// REFERENCES the shared DocumentType vocabulary, it never
// duplicates the Document entity.
//
// DocumentRequirement = "employees of category X must hold a
// verified <documentType> that has not expired". Requirements
// are deliberately CONFIGURABLE (not hard-coded law):
//
//   * employmentType null  -> applies to every employment type
//   * company / legal entity via organizational link (null = all)
//   * expiryAlertDays      -> how long BEFORE expiry the doc
//                             counts as "expiring" and reminders
//   * isMandatory          -> only MANDATORY requirements feed
//                             the compliance status computation
//
// "Document present" is never treated as "valid": only HR-verified
// documents can satisfy a requirement, and expiries re-check on
// every compliance query (no stale snapshots).
// ============================================================

entity DocumentRequirement : managed {
    key ID : UUID;

    // Human-readable identifier, e.g. REQ0001 (@assert.unique).
    requirementCode : String(20) @assert.unique;

    name : String(100) not null;

    // MUST be a value of the shared enums.DocumentType catalog.
    documentType : enums.DocumentType not null;

    // Applicability. Null = applies to ALL employment types.
    appliesToEmploymentType : enums.EmploymentType;

    // Optional link to a BusinessUnit/Company for legal-entity
    // scoping: null = every entity. (BusinessUnit→Company gives
    // the legal-entity boundary in the existing org model.)
    appliesToBusinessUnit : Association to BusinessUnit;

    // Does this requirement feed the compliance status?
    isMandatory : Boolean default true;

    // When true, a compliant document must carry its issueDate
    // (audited against the VERIFY action, see handlers).
    requiresIssueDate : Boolean default false;

    // Days before expiryDate when the document starts counting as
    // "Expiring" and the reminder action notifies the employee.
    // 0 (or null) = the document type has no meaningful expiry.
    expiryAlertDays : Integer default 30;

    // Configuration lifecycle, like every other master data row.
    status : enums.Status default 'Active';
    effectiveFrom : Date not null;
    effectiveTo   : Date;

    description : String(255);
}
