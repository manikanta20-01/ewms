const cds = require("@sap/cds");
const { persistAudit } = require("../../common/utils/audit");
const { toCsv } = require("../../common/utils/csv-builder");
const A = require("../../common/utils/analytics-queries");
const {
  INTERACTIVE_LIMIT, EXPORT_MAX, DATE_COLUMN,
  isHR, isAssetReader, parseODataFilters, validateDateRange,
  normalizeExportLimit,
} = require("./reports-common");
const B = require("./report-builders");

// ============================================================
// SPRINT 23 - REPORT READERS + CSV EXPORT
// ------------------------------------------------------------
// ONE behaviour table for all nine reports. Interactive reads
// honor $filter ($top caps the result; the server never returns
// more than INTERACTIVE_LIMIT rows) and the export action runs
// the SAME builders with the SAME filter fields, capped by the
// caller's `limit` (<= EXPORT_MAX). A report larger than the
// cap is REFUSED with 413 - never silently truncated, because
// a cut-off export would look complete and lie.
// ============================================================

const READERS = [ // [entity name, builder key, role gate]
  ["Workforce", "Workforce", isHR],
  ["Attendance", "Attendance", isHR],
  ["Leave", "Leave", isHR],
  ["Recruitment", "Recruitment", isHR],
  ["Performance", "Performance", isHR],
  ["Asset", "Asset", isAssetReader],
  ["DocumentExpiry", "DocumentExpiry", isHR],
  ["Helpdesk", "Helpdesk", isHR],
  ["Exit", "Exit", isHR],
];

module.exports = (srv) => {
  const q = srv.entities;

  for (const [entityName, builderKey, roleGate] of READERS) {
    srv.on("READ", q[entityName], async (req) => {
      if (!roleGate(req)) return [];
      // $filter MUST name the entity's OWN columns (CAP enforces
      // that); the parser maps the report's date axis with ge/le
      // onto the same fromDate/toDate window the exporter uses.
      const filters = parseODataFilters(req, DATE_COLUMN[entityName]);
      const rangeErr = validateDateRange(filters.fromDate, filters.toDate);
      if (rangeErr) return req.reject(400, rangeErr);

      const tx = cds.transaction(req);
      let rows = await B.builders[builderKey](tx, filters);

      // Interactive pagination: $top is honored (CAP stores $top
      // in SELECT.limit.rows for tableless entities, so read the
      // written query directly) and the server clamps it - larger
      // reads must use the export (with its explicit limit).
      let top = Number(req.query?.SELECT?.top ??
        req.query?.SELECT?.limit?.rows?.val ?? 0);
      if (!top || top <= 0) top = INTERACTIVE_LIMIT;
      if (top > INTERACTIVE_LIMIT) top = INTERACTIVE_LIMIT;
      rows = rows.slice(0, top);
      return rows;
    });
  }

  // ------------------------------------------------------------
  // ExportCSV - the SAME data path as above, as CSV text.
  // ------------------------------------------------------------
  srv.on("ExportCSV", async (req) => {
    const names = Object.keys(B.builders); // every supported report
    /** Which role may see this report (same map as the readers). */
    const gateFor = (report) =>
      report === "Asset" ? isAssetReader : isHR;

    const report = req.data?.report;
    if (!report || !B.builders[report]) {
      return req.reject(400, `Unknown report '${report ?? ""}'. Supported: ${names.join(", ")}.`);
    }
    if (!gateFor(report)(req)) {
      return req.reject(403, "Reports are HR/management surfaces. Ask HR for access.");
    }

    const f = { ...req.data };
    delete f.report;
    delete f.limit;

    const rangeErr = validateDateRange(f.fromDate, f.toDate);
    if (rangeErr) return req.reject(400, rangeErr);

    const limit = normalizeExportLimit(req.data?.limit);
    const tx = cds.transaction(req);
    let rows;
    try {
      rows = await B.builders[report](tx, f);
    } catch (e) {
      // NEVER leak SQL/stack detail to the client (beginner rule:
      // log server-side, answer a clean 500 message).
      req.log?.warn?.(`ExportCSV failed for ${report}: ${e.message}`);
      return req.reject(500, "Report generation failed. Check the filters.");
    }

    if (rows.length > limit) {
      return req.reject(413,
        `This export has ${rows.length} rows, above the limit of ${limit}. ` +
        `Set a smaller limit (max ${EXPORT_MAX}) or narrow the filters.`);
    }

    // Content metadata: the filename carries ONLY the report type
    // and date - no personal or sensitive data in filenames.
    const fileStamp = A.today().replace(/-/g, "");
    const res = req.http?.res;
    if (res?.setHeader) {
      res.setHeader("Content-Disposition",
        `attachment; filename="ewms-${report.toLowerCase()}-${fileStamp}.csv"`);
    }

    // Audit the export action itself WITHOUT report contents
    // (audit conventions: facts, not payload copies).
    try {
      await persistAudit(req, "EXPORT", "Reports",
        { report, filters: { ...f } }, null);
    } catch (e) {
      req.log?.warn?.("Export audit write failed (non-fatal): " + e.message);
    }

    return toCsv(B.COLUMNS[report], rows);
  });
};
