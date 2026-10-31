// ============================================================
// SAFE CSV BUILDER (Sprint 23 export)
// ------------------------------------------------------------
// One small dependency-free helper used by every export, so the
// CSV качествоrules live in exactly one place:
//
//   1. RFC-4180-style quoting: a cell containing a comma, a
//      double quote, a newline (CR/LF) is wrapped in "...\" and
//      embedded quotes are doubled.
//   2. Spreadsheet FORMULA-INJECTION protection: a string cell
//      that Excel/LibreOffice would evaluate as a formula when a
//      user opens the file gets a leading apostrophe (') so it
//      opens as text. This only fires on =, +, @, tab/CR starts
//      and on '-' ONLY when it looks like a formula lead-in
//      ('-=SUM(...)', '--...'), so plain numbers such as -5 or
//      -0.5 are never corrupted.
//   3. null/undefined become empty cells; numbers/booleans are
//      stringified plainly.
//
// No temporary files, no package.json dependency needed.
// ============================================================

function needsQuoting(s) {
  return /["\n\r,]/.test(s);
}

/**
 * Returns the SAFE spreadsheet cell text, or null when the value
 * is not formula-like (the prefix rule list + doc above).
 */
function injectionPrefix(raw) {
  const c = raw[0];
  if (c === "=" || c === "+" || c === "@" || c === "\t" || c === "\r") return "'";
  if (c === "-" && /^[=+@-]/.test(raw.slice(1))) return "'";
  return null;
}

function escapeCell(value) {
  if (value == null) return "";
  // Everything is stringified from here (String(null) handled above).
  let raw = typeof value === "string" ? value : String(value);
  const prefix = injectionPrefix(raw);
  if (prefix) raw = prefix + raw;
  if (needsQuoting(raw)) raw = `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/**
 * Build the CSV text for rows of uniform objects.
 *
 * @param columns [{ name: "rowKey", header: "Stable Column" }, ...]
 * @param rows    [obj, ...] - objects whose keys match column names
 * @returns full CSV text (UTF-8, LF line endings, trailing newline)
 */
function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const lines = [header];
  for (const row of rows || []) {
    lines.push(columns.map((c) => escapeCell(row[c.name])).join(","));
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

module.exports = { toCsv, escapeCell, injectionPrefix };
