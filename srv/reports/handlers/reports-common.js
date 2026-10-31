const { hasRole } = require("../../common/auth/authorization");

// ============================================================
// SPRINT 23 - SHARED REPORT HELPERS
// ------------------------------------------------------------
// Small building blocks shared by the reader and the export
// handlers so BOTH surfaces behave identically:
//
//   * role gates (mirrors of the security annotations),
//   * the repo-wide simple $filter convention parser,
//   * date-range validation (UTC dates, max one-year span),
//   * the row limits (interactive / export caps).
// ============================================================

/** Row cap for INTERACTIVE reads (OData lists). */
const INTERACTIVE_LIMIT = 250;

/** Highest row count an export may be ASKED for (safety cap). */
const EXPORT_MAX = 10000;

/** Default export row budget when the caller passes no limit. */
const EXPORT_DEFAULT_ROWS = 5000;

/** The 366-day window keeps date ranges sentinel-proof. */
const MAX_RANGE_DAYS = 366;

/** HR trio + SystemAdmin: the readers of every report. */
function isHR(req) {
  return hasRole(req, "HRExecutive", "HRAdmin", "SystemAdmin");
}

/** The asset report additionally allows finance (source-module rule). */
function isAssetReader(req) {
  return isHR(req) || hasRole(req, "FinanceManager");
}

/**
 * The date column each report filters its range on. The READ
 * $filter MUST name the entity's OWN column (CAP type-checks
 * $filter against the metadata - this is Fiori-friendly and
 * prevents synthetic filter fields); this map says which one is
 * the report's range axis so the exporter's fromDate/toDate and
 * the reader's ge/le mean the same thing.
 */
const DATE_COLUMN = {
  Workforce: "joiningDate",
  Attendance: "attendanceDate",
  Leave: "fromDate",
  DocumentExpiry: "expiryDate",
  Helpdesk: "createdAt",
  Exit: "createdAt",
  Recruitment: "createdAt",
  Performance: "createdAt",
};

/**
 * Parse a simple OData $filter (a eq b and c ge d ...) with full
 * operator awareness:
 *   * `eq` on a normal column         -> filters[column]
 *   * ge/gt|le/lt on the DATE column  -> filters.fromDate/toDate
 *     (eq on the date column becomes the same single-day window,
 *     which for an inclusive range equals an exact match)
 * Unknown/composite operands are IGNORED by construction - a
 * filter can never EXPAND the result beyond what is supported.
 */
function parseODataFilters(req, dateColumn) {
  const where = req.query?.SELECT?.where || [];
  const out = {};
  // CAP stores OData operators as SQL-style symbols ('=', '>=',
  // '<=', '>', '<'); accept the word forms too, for safety.
  const FROM_OPS = [">=", ">", "ge", "gt"];
  const TO_OPS = ["<=", "<", "le", "lt"];
  const EQ_OPS = ["=", "eq"];
  for (let i = 0; i + 2 < where.length; i += 1) {
    const ref = where[i]?.ref?.[where[i].ref.length - 1];
    if (!ref) continue; // 'and' separators and stray tokens
    const op = where[i + 1];
    const rhs = where[i + 2];
    if (typeof op !== "string") continue;
    if (!rhs || rhs.val == null) continue;
    if (dateColumn && ref === dateColumn) {
      if (FROM_OPS.includes(op)) out.fromDate = rhs.val;
      else if (TO_OPS.includes(op)) out.toDate = rhs.val;
      else if (EQ_OPS.includes(op)) { out.fromDate = rhs.val; out.toDate = rhs.val; }
      // any other operator on the date axis is ignored - filters
      // can never EXPAND a report beyond its supported set
      i += 2; // consumed ref+op+val
      continue;
    }
    if (EQ_OPS.includes(op)) out[ref] = rhs.val;
    i += 2;
  }
  return out;
}

/**
 * Deprecated simple two-token scan (kept for tests/back-compat in
 * this module only - the readers use parseODataFilters).
 */
function simpleFilterValues(req) {
  const where = req.query?.SELECT?.where || [];
  const out = {};
  for (let i = 0; i < where.length - 2; i += 1) {
    const ref = where[i]?.ref;
    const val = where[i + 2]?.val;
    if (ref && val != null) out[ref[ref.length - 1]] = val;
  }
  return out;
}

/**
 * Validate an (fromDate, toDate) pair for report/export use.
 * Returns an error string or null when acceptable.
 */
function validateDateRange(fromDate, toDate) {
  if (!fromDate && !toDate) return null; // range is optional
  if ((fromDate && !toDate) || (!fromDate && toDate)) {
    return "fromDate and toDate must be given together.";
  }
  if (fromDate > toDate) {
    return "fromDate must not be after toDate.";
  }
  const spanDays =
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
    (24 * 60 * 60 * 1000);
  if (!(spanDays <= MAX_RANGE_DAYS)) {
    return `Date range may not exceed ${MAX_RANGE_DAYS} days. Narrow the range.`;
  }
  return null;
}

/** Clamp + validate the requested export limit. */
function normalizeExportLimit(limit) {
  const n = Number(limit ?? 0);
  if (!n || n <= 0) return EXPORT_DEFAULT_ROWS;
  return Math.min(n, EXPORT_MAX);
}

module.exports = {
  INTERACTIVE_LIMIT,
  EXPORT_MAX,
  EXPORT_DEFAULT_ROWS,
  MAX_RANGE_DAYS,
  DATE_COLUMN,
  isHR,
  isAssetReader,
  simpleFilterValues,
  parseODataFilters,
  validateDateRange,
  normalizeExportLimit,
};
