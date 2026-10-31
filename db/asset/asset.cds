namespace ewms.db.asset;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';

// ============================================================
// SPRINT 14 - ASSET MANAGEMENT
// ------------------------------------------------------------
// This model covers the full asset journey:
//
//   AssetCategory (maintainable master data)
//        |
//   Asset (AVAILABLE) --assignAsset--> AssetAssignment (Active)
//        |                                   |
//        |                    returnAsset / transferAsset
//        |                    (closes the assignment, opens the
//        |                     next one - rows are NEVER deleted)
//        v
//   AssetEvent (append-only history of every lifecycle change)
//
// IMPORTANT design decisions:
//   * The asset NEVER stores "the employee" as plain data that
//     gets overwritten. The ACTIVE assignment is the source of
//     truth; `currentHolder` on Asset is a handler-maintained
//     mirror (association) so lists and Sprint 21 Exit
//     Management can query "who has this" with ONE read.
//   * Assignment history is preserved: every assignment/transfer/
//     return keeps its row with conditions and dates. Exit
//     Management (Sprint 21) can therefore answer: which assets
//     does employee X hold, which are active, what was returned
//     and in which condition.
//   * No approval workflow is wired in Sprint 14: all lifecycle
//     operations are direct, role-restricted actions (asset/HR
//     admin). If a future sprint requires approval-controlled
//     disposal, the Sprint 10 generic engine can be attached via
//     registerCallbacks exactly like Leave/Offers/Reviews - no
//     asset code needs to change structurally.
//   * Every important state change writes an AssetEvent row AND
//     an audit row AND (where useful) a notification - all via
//     the shared helpers, no new infrastructure.
// ============================================================

// ------------------------------------------------------------
// ASSET CATEGORY - maintainable master data (Laptop, Vehicle...)
// ------------------------------------------------------------
// Categories are DATA, not hard-coded logic: business rules never
// branch on a specific category value. New categories are simply
// rows created by HR/SystemAdmin.
// ------------------------------------------------------------
entity AssetCategory : managed {
    key ID : UUID;

    // Auto-generated reference, e.g. CAT0001.
    code : String(20) @assert.unique;

    name : type.Name100 not null;
    description : type.Description;

    // Inactive categories disappear from picklists but keep their
    // historical assets intact.
    isActive : Boolean default true;
}

// ------------------------------------------------------------
// ASSET - one physical asset, tracked over its whole life
// ------------------------------------------------------------
entity Asset : managed {
    key ID : UUID;

    // Auto-generated unique tag, e.g. AST0001.
    assetTag : String(30) @assert.unique;

    name : type.Name100 not null;
    category : Association to AssetCategory not null;
    description : type.Description;

    // Identification / procurement data.
    serialNumber : String(100) @assert.unique; // nullable - furniture etc. has none
    model : String(100);
    manufacturer : String(100);

    purchaseDate : Date;
    purchaseCost : Decimal(12, 2);
    currency : enums.CurrencyType default 'INR';
    warrantyUntil : Date;

    // Lifecycle state (transitions enforced in asset-lifecycle.js):
    // Available -> Assigned -> (return) -> Available / InRepair;
    // Lost, Damaged, Retired, Disposed as controlled side exits.
    status : enums.AssetStatus default 'Available';

    // Physical condition, recorded at assignment / return /
    // inspection / repair completion.
    condition : enums.AssetCondition default 'New';

    // Storage / office location where appropriate.
    location : String(100);

    // ---------------------------------------------------------
    // Handler-maintained mirror of the ACTIVE assignment's
    // employee. Never written directly by clients (UPDATE guard);
    // cleared on return, set on assign/transfer. Lets OData
    // clients and Sprint 21 filter assets by holder in one query.
    // ---------------------------------------------------------
    currentHolder : Association to Employee;

    notes : type.Description;

    // The assignment history (rows are never deleted).
    assignments : Association to many AssetAssignment on assignments.asset = $self;
    events : Association to many AssetEvent on events.asset = $self;
}

// ------------------------------------------------------------
// ASSET ASSIGNMENT - one custody period of one asset
// ------------------------------------------------------------
// One row per time the asset was handed to one employee. Closed
// rows (Returned/Cancelled) are the history; exactly ONE Active
// assignment may exist per asset at a time (enforced in the
// handler, retry-safe).
// ------------------------------------------------------------
entity AssetAssignment : managed {
    key ID : UUID;

    asset : Association to Asset not null;
    employee : Association to Employee not null;
    assignedBy : Association to Employee not null;

    assignmentDate : Date not null;
    expectedReturnDate : Date;
    actualReturnDate : Date;

    // Active -> Returned (via returnAsset / transferAsset) or
    // Cancelled (administrative correction). History is preserved.
    status : enums.AssetAssignmentStatus default 'Active';

    conditionAtAssignment : enums.AssetCondition;
    conditionAtReturn : enums.AssetCondition;

    // The receiving employee confirms custody (own rows only).
    acknowledged : Boolean default false;
    acknowledgedOn : Timestamp;

    notes : type.Description;
}

// ------------------------------------------------------------
// ASSET EVENT - append-only history of important lifecycle events
// ------------------------------------------------------------
// One row per event type (constants in asset-lifecycle.js):
// CREATED, ASSIGNED, TRANSFERRED, RETURNED, INSPECTED,
// REPAIR_STARTED, REPAIR_COMPLETED, MARKED_LOST, MARKED_DAMAGED,
// RETIRED, DISPOSED. Never updated or deleted - the audit trail
// of "what happened to this asset" lives here and in AuditLog.
// ------------------------------------------------------------
entity AssetEvent : managed {
    key ID : UUID;

    asset : Association to Asset not null;
    assignment : Association to AssetAssignment; // when event belongs to a custody period

    eventType : String(30) not null;
    eventOn : Timestamp not null;

    // Who caused the event (null for purely technical entries).
    actor : Association to Employee;

    fromStatus : enums.AssetStatus;
    toStatus : enums.AssetStatus;
    condition : enums.AssetCondition;

    details : String(500);
}
