using { ewms.db.asset as db } from '../../db/schema';

// ============================================================
// SPRINT 14 - ASSET MANAGEMENT (SERVICE)
// ------------------------------------------------------------
// Exposes the asset lifecycle:
//
//   AssetCategories - maintainable master data (plain CRUD).
//
//   Assets - CRUD for master data + ALL state changes as bound
//   actions (assign / return / transfer / inspect / repair /
//   lost / damaged / retire / dispose). Direct PATCH can never
//   move `status` or `condition` - the actions own the lifecycle.
//
//   AssetAssignments - the custody history (closed rows are kept
//   forever). The receiving employee acknowledges their rows.
//
//   AssetEvents - append-only history; read-only for authorized
//   roles.
//
// Security lives in asset-security.cds (Sprint 9 roles only).
// No approval workflow is wired in this sprint - see
// docs/sprints/SPRINT-14.md for the documented extension point.
// ============================================================

service AssetService @(requires: 'authenticated-user') {

    // ---------------------------------------------------------
    // ASSET CATEGORIES (maintainable master data)
    // ---------------------------------------------------------
    entity AssetCategories as projection on db.AssetCategory;

    // ---------------------------------------------------------
    // ASSETS with the full lifecycle as bound actions.
    // ---------------------------------------------------------
    entity Assets as projection on db.Asset actions {
        // Available -> Assigned (creates the Active assignment).
        action assignAsset(employee_ID : UUID, expectedReturnDate : Date,
                           conditionAtAssignment : String, notes : String(500)) returns String;

        // Assigned -> Available (condition Damaged/Critical -> InRepair).
        action returnAsset(condition : String, notes : String(500)) returns String;

        // Assigned -> Assigned (closes A's assignment, opens B's).
        action transferAsset(newEmployee_ID : UUID, condition : String,
                             notes : String(500)) returns String;

        // Records condition + outcome; Reusable -> Available,
        // RepairRequired -> InRepair; retire/dispose outcomes route
        // to the dedicated actions.
        action inspectAsset(condition : String, outcome : String,
                            notes : String(500)) returns String;

        // Available/Damaged -> InRepair.
        action startRepair(vendor : String(100), notes : String(500)) returns String;

        // InRepair -> Available (with the resulting condition).
        action completeRepair(condition : String, repairCost : Decimal(12,2),
                              vendor : String(100), notes : String(500)) returns String;

        // Assigned/Available -> Lost (reason required).
        action markLost(reason : String(500)) returns String;

        // Assigned/Available -> Damaged (condition + reason).
        action markDamaged(condition : String, reason : String(500)) returns String;

        // End of life (blocked while the asset is assigned).
        action retireAsset(reason : String(500)) returns String;

        // Final state (blocked while assigned; Retired first by
        // convention but reachable from other non-assigned states).
        action disposeAsset(reason : String(500)) returns String;
    };

    // ---------------------------------------------------------
    // ASSET ASSIGNMENTS - custody history + employee acknowledgement
    // ---------------------------------------------------------
    entity AssetAssignments as projection on db.AssetAssignment actions {
        // The receiving employee confirms custody (own rows only).
        action AcknowledgeAssignment() returns String;
    };

    // ---------------------------------------------------------
    // ASSET EVENTS - append-only lifecycle history (read-only).
    // ---------------------------------------------------------
    entity AssetEvents as projection on db.AssetEvent;
}
