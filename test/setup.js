// ============================================================
// EWMS - AUTOMATED TEST SETUP (CAP cds.test)
// ------------------------------------------------------------
// Reusable setup for automated tests in this project.
//
// WHAT THIS DOES
//   * Starts ONE CAP test server for the whole test run using
//     cds.test(). This is the CAP-supported way to run tests
//     without touching the developer's db.sqlite file.
//   * In-memory test database:
//       - The project already defines a [test] profile in
//         package.json that overrides cds.requires.db to an
//         in-memory SQLite database (url: ":memory:").
//       - When tests run under CDS_ENV=test, the CAP test server
//         boots with that isolated in-memory database.
//       - This keeps automated tests separate from the normal
//         development database.
//   * Authentication:
//       - The project uses mocked auth (package.json cds.requires.auth).
//       - Mock users and roles are defined in package.json and reused
//         by all tests.
//   * Schema:
//       - The CAP test server loads the project model from
//         srv/server.js (which exports cds.server).
//       - The test server therefore serves all project services
//         and uses the seeded CSV data automatically.
//   * Cleanup / lifecycle:
//       - cds.test() controls server startup/shutdown for the
//         test runner. We do NOT call process.exit(), kill, or
//         leave background servers running.
//       - Tests finish when all suites/tests complete and the
//         runner exits normally.
//
// HOW TO RUN
//   From the EWMS project root:
//     CDS_ENV=test node --test 'test/**/*.test.js'
//
//   Or use the project test script:
//     npm test
//
// NOTES
//   * Do NOT create a separate persistent test database file here.
//     The in-memory profile is intentional and keeps tests isolated.
//   * Do NOT change development (db.sqlite) or production (HANA)
//     database configuration in this file. Those settings live in
//     package.json cds.requires / cds.[test] / cds.[production].
//   * This setup is intended to be imported by other test files
//     so the CAP test server is started once.
// ============================================================

const cds = require("@sap/cds");

/**
 * Start the CAP test server once and return a small harness with
 * the HTTP helpers bound to that single server.
 *
 * Only ONE cds.test() server is started per test file that imports
 * this setup. Other test files should also import this module so
 * they share the same pattern rather than starting duplicate servers.
 */
function startTestHarness() {
  // cds.test() starts the in-memory test server.
  const harness = cds.test();

  return {
    /**
     * Authenticated HTTP helpers bound to the CAP test server.
     * Typical usage in a test file:
     *
     *   const { GET, POST, PATCH } = setup();
     *
     * Requests use the mock users defined in package.json.
     */
    GET: harness.GET.bind(harness),
    POST: harness.POST.bind(harness),
    PATCH: harness.PATCH.bind(harness),
    DELETE: harness.DELETE.bind(harness),

    /**
     * The underlying cds.test() harness is exposed so test files
     * can wait for readiness if needed, without creating another
     * server.
     */
    harness,
  };
}

module.exports = { startTestHarness };
