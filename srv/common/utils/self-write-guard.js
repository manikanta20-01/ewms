// ============================================================
// EWMS - ROW-LEVEL CREATE GUARD (shared helper)
// ------------------------------------------------------------
// WHY THIS EXISTS
//   CAP's @restrict where-clauses reliably filter READs, but for
//   CREATE operations the where-clause cannot match a not-yet-
//   existing row - so a plain employee could historically POST a
//   leave request or attendance row for SOMEONE ELSE by passing
//   their ID as employee_ID. The role grant lets the request
//   through, only the row-ownership was (silently) unchecked.
//
//   This helper closes that gap for the modules that expose
//   self-service CREATE. Call it from a srv.before("CREATE")
//   handler with the request and the foreign-key field; it
//   rejects the request with 403 when:
//     * the caller is a plain Employee (no admin/HR role), and
//     * req.data.<field> is set and does NOT equal the caller's
//       own $user.employeeId.
//
//   HR/Admin roles keep full CRUD (matches the @restrict grants).
// ============================================================

const { hasGroup } = require("../auth/authorization");

// Role groups that may legitimately write other employees' rows;
// mirrors the unrestricted CRUD grants in the *-security.cds files.
const ADMIN_GROUPS = ["HR", "PAYROLL", "MANAGEMENT"];

/**
 * Guard a WRITE (create or update) against touching other users'
 * rows. SQL where-clauses cannot express row-ownership for CREATE,
 * so this explicit check closes the gap.
 *
 * @param {cds.Request} req    the current request
 * @param {string} field       the FK field carrying the owner ID,
 *                             e.g. "employee_ID"
 * @param {string[]} [adminGroups] role groups allowed to bypass
 *                             the check (defaults to HR, Payroll,
 *                             and Management roles)
 * @returns {Promise<void>} rejects the request with 403 when a
 *                          non-admin caller writes another employee's row
 */
async function assertSelfWrite(req, field, adminGroups = ADMIN_GROUPS) {
  if (req.data?.[field] == null) return;

  // Admin roles bypass (mirror the CREATE grant in security.cds).
  if (adminGroups.some((g) => hasGroup(req, g))) return;

  // The caller must own the row via their own employeeId. Mocked
  // auth defines employeeId directly on the user object in some
  // setups; the bootstrap middleware bridges it into user.attr,
  // but read BOTH here so tests and real profiles behave alike.
  const own = req.user?.attr?.employeeId ?? req.user?.employeeId;
  if (own && String(req.data[field]) !== String(own)) {
    // req.reject THROWS: the before-handler aborts here, no later
    // validation runs, and CAP surfaces exactly this one 403.
    return req.reject(
      403,
      `You may only ${req.event === "UPDATE" ? "change" : "create"} records for yourself.`,
    );
  }
}

/** Convenience wrapper for CREATE-only guards. */
async function assertSelfCreate(req, field, adminGroups) {
  return assertSelfWrite(req, field, adminGroups);
}

module.exports = { assertSelfWrite, assertSelfCreate };
