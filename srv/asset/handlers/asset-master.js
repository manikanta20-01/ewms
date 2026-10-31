const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { persistAudit } = require("../../common/utils/audit");

// ============================================================
// SPRINT 14 - ASSET MASTER DATA
// ------------------------------------------------------------
// Covers everything that is NOT a lifecycle transition:
//   * AssetCategory CREATE (auto code)
//   * Asset CREATE (auto tag, category/date validation) + the
//     audit row for "asset created"
//   * The UPDATE guard that keeps direct PATCHes from bypassing
//     the lifecycle (status/condition/currentHolder are owned by
//     the actions; disposed assets are immutable)
// ============================================================

const CATEGORY_ENTITY = "AssetCategories";
const ASSET_ENTITY = "Assets"; // service projection (registration only)
const ASSET_DB = "ewms.db.asset.Asset"; // DB table (queries)
const CATEGORY_DB = "ewms.db.asset.AssetCategory";

module.exports = (srv) => {
  // ----------------------------------------------------------
  // Categories: auto code (CAT0001...)
  // ----------------------------------------------------------
  srv.before("CREATE", CATEGORY_ENTITY, async (req) => {
    req.data.code = await generateCode(req, CATEGORY_DB, "code", "CAT", 4);
    if (req.data.isActive === undefined) req.data.isActive = true;
  });

  // ----------------------------------------------------------
  // Asset CREATE: auto tag, validations, CREATED audit + event.
  // ----------------------------------------------------------
  srv.before("CREATE", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);

    req.data.assetTag = await generateCode(req, ASSET_DB, "assetTag", "AST", 4);
    if (!req.data.status) req.data.status = "Available";
    if (!req.data.condition) req.data.condition = "New";

    if (!req.data.category_ID) {
      return req.error(400, "An asset category is required.");
    }
    const category = await tx.run(SELECT.one.from(CATEGORY_DB).where({ ID: req.data.category_ID }));
    if (!category) return req.error(404, "Asset category not found.");
    if (!category.isActive) {
      return req.error(400, "The asset category is inactive and cannot be used for new assets.");
    }

    // Serial numbers must be unique. NOTE: @assert.unique is
    // declared on the model for documentation/HANA tooling, but
    // this CAP runtime does not enforce it for SQLite, so the
    // handler performs the check explicitly.
    if (req.data.serialNumber) {
      const twin = await tx.run(
        SELECT.one.from(ASSET_DB).where({ serialNumber: req.data.serialNumber }),
      );
      if (twin) {
        return req.error(
          400,
          `serialNumber '${req.data.serialNumber}' is already used by asset ${twin.assetTag}.`,
        );
      }
    }

    // Sensible procurement dates: nothing is bought in the future
    // and warranty cannot end before the purchase happened.
    const today = new Date().toISOString().slice(0, 10);
    if (req.data.purchaseDate && req.data.purchaseDate > today) {
      return req.error(400, "purchaseDate cannot be in the future.");
    }
    if (req.data.purchaseDate && req.data.warrantyUntil && req.data.warrantyUntil < req.data.purchaseDate) {
      return req.error(400, "warrantyUntil cannot be before purchaseDate.");
    }

    // The holder is NEVER set on create - custody only starts via
    // the assignAsset action (which records the assignment).
    if (req.data.currentHolder_ID) {
      return req.error(400, "currentHolder is managed by the assignAsset action.");
    }
  });

  srv.after("CREATE", ASSET_ENTITY, async (data, req) => {
    await persistAudit(req, "CREATE", "Assets", null, { assetTag: data.assetTag, name: data.name });
  });

  // ----------------------------------------------------------
  // UPDATE guard: direct edits may never bypass the lifecycle.
  // ----------------------------------------------------------
  srv.before("UPDATE", ASSET_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    // Raw-UUID-safe key extraction (CAP 8 bound/CUD pattern).
    const p = req.params?.[0];
    const keys = p ? (typeof p === "object" ? p : { ID: p }) : { ID: req.data?.ID };

    const asset = await tx.run(SELECT.one.from(ASSET_DB).where(keys));
    if (!asset) return req.error(404, "Asset not found.");

    // Disposed assets are historical records - immutable.
    if (asset.status === "Disposed") {
      return req.error(400, "A disposed asset can no longer be modified.");
    }
    for (const field of ["status", "condition", "currentHolder_ID"]) {
      if (field in (req.data || {})) {
        return req.error(
          400,
          `Field '${field}' is controlled by the asset lifecycle actions (assignAsset, returnAsset, inspectAsset, ...).`,
        );
      }
    }
  });
};
