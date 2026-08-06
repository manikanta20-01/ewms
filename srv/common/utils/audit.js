const cds = require("@sap/cds");
const { SELECT, INSERT } = cds.ql;

// Structured SAP CAP logging (instead of console.*)
const LOG = cds.log("audit");

// Field names (lowercased) that must never be written to the audit log
// in cleartext. Covers auth secrets, government/bank IDs, and every
// per-employee compensation figure exposed through the audited payroll
// entities (EmployeeSalaries, PayrollProcesses, PayrollDetails,
// SalaryStructureItems).
const SENSITIVE_FIELDS = [
  "password",
  "passwordhash",
  "refreshtoken",
  "accesstoken",
  "jwt",
  "otp",
  "secret",
  "pan",
  "aadhaar",
  "passport",
  "bankaccount",
  "accountnumber",
  "ifsc",
  "swift",
  "cvv",
  "salary",
  "salarystructure",
  "grosssalary",
  "netsalary",
  "totaldeductions",
  "totalearnings",
  "calculatedamount",
  "monthlyctc",
  "annualctc",
  "amount",
  "percentage",
  "rate",
];

/**
 * Recursively sanitizes sensitive fields from the payload.
 */
function sanitize(data) {
  if (!data) return null;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(sanitize);

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof value === "object") {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Deep Merge Strategy: Prevents nested objects from being overwritten
 * entirely during PATCH.
 */
function deepMerge(target, source) {
  const output = { ...target };
  if (!source) return output;

  for (const key of Object.keys(source)) {
    if (
      source[key] instanceof Object &&
      key in target &&
      target[key] instanceof Object
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

/**
 * Extracts entity keys safely, supporting composite keys and single scalar keys.
 *
 * req.params[0] can be either:
 *  - an object, e.g. { ID: '...' } or { tenant: '...', ID: '...' } (composite keys), or
 *  - a plain scalar, e.g. 'b0000000-0000-0000-0000-000000000001' (single-key entities).
 *
 * Passing a raw scalar straight into .where(...) makes the CQN parser treat it as an
 * expression (e.g. splitting a UUID on its dashes as subtraction), which throws and
 * silently skips the audit write. Scalars must be wrapped as { <keyElement>: value }.
 */
function extractKeys(req) {
  if (req.params && req.params.length > 0) {
    const raw = req.params[0];

    if (raw && typeof raw === "object") return raw;

    if (raw !== undefined && raw !== null) {
      const keyElements = req.target?.keys ? Object.keys(req.target.keys) : [];
      const keyElement =
        keyElements.find((k) => k !== "IsActiveEntity") || "ID";
      return { [keyElement]: raw };
    }
  }
  if (req.data && req.data.ID) return { ID: req.data.ID };
  return req.query.UPDATE?.where || req.query.DELETE?.where || null;
}

/**
 * Persists an audit log entry transactionally.
 */
async function persistAudit(req, action, entityName, oldVal, newVal) {
  if (!req || !req.user) return;
  const tx = cds.transaction(req);

  // Rich User Context: capture specific employee and role mapping
  const userId = req.user.id || "system";
  const employeeId = req.user.attr?.employeeId || null;
  const departmentId = req.user.attr?.departmentId || null;
  const roles = req.user.roles
    ? JSON.stringify(Object.keys(req.user.roles))
    : null;

  // Correlation ID: links logs across the entire transaction lifecycle
  const correlationId =
    req.headers?.["x-correlation-id"] ||
    req.headers?.["x-request-id"] ||
    req.id;

  try {
    await tx.run(
      INSERT.into("ewms.db.common.AuditLog").entries({
        user: userId,
        employeeId: employeeId,
        departmentId: departmentId,
        roles: roles,
        correlationId: correlationId,
        action: action,
        entity: entityName,
        oldName: oldVal ? JSON.stringify(sanitize(oldVal)) : null,
        newName: newVal ? JSON.stringify(sanitize(newVal)) : null,
        // createdAt/createdBy come from the 'managed' aspect on AuditLog
      }),
    );
  } catch (error) {
    LOG.error(`Transactional write failed for ${entityName}:`, error.message);
  }
}

/**
 * Registers audit hooks for a service with Opt-in Auditing.
 * @param {object} srv - The CDS service instance
 * @param {object} options - Configuration options (e.g., { include: ['Employees', 'Banks'] })
 */
function registerAuditHooks(srv, options = {}) {
  const allowedEntities = options.include || [];

  // Extended Technical Exclusions
  const EXCLUDED_ENTITIES = [
    "AuditLog",
    "LoginHistory",
    "AppUsers",
    "PasswordHistory",
    "RefreshTokens",
    "PasswordResetTokens",
  ];

  for (const entity of Object.values(srv.entities)) {
    const shortName = entity.name.split(".").pop();

    // Enforce opt-in list and exclusions
    if (allowedEntities.length > 0 && !allowedEntities.includes(shortName))
      continue;
    if (EXCLUDED_ENTITIES.some((excluded) => shortName.endsWith(excluded)))
      continue;

    srv.before(["UPDATE", "DELETE"], entity.name, async (req) => {
      const tx = cds.transaction(req);
      const keys = extractKeys(req);

      if (keys) {
        try {
          req._oldData = await tx.run(SELECT.one.from(entity.name).where(keys));
        } catch (err) {
          LOG.warn(`Failed to fetch old state for ${shortName}.`);
        }
      }
    });

    srv.after("CREATE", entity.name, async (data, req) => {
      await persistAudit(req, "CREATE", shortName, null, data);
    });

    srv.after("UPDATE", entity.name, async (data, req) => {
      if (!req._oldData) return;
      // Use the deep merge helper for complex/nested PATCH payloads
      const fullNewState = deepMerge(req._oldData, data);
      await persistAudit(req, "UPDATE", shortName, req._oldData, fullNewState);
    });

    srv.after("DELETE", entity.name, async (_, req) => {
      if (!req._oldData) return;
      await persistAudit(req, "DELETE", shortName, req._oldData, null);
    });
  }
}

/**
 * Parses the stored oldName/newName JSON strings back into real objects.
 * Safe against null values and against pre-existing rows that aren't valid JSON.
 */
function parseAuditPayload(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value; // already an object
  try {
    return JSON.parse(value);
  } catch {
    return value; // leave malformed/legacy data as-is rather than throwing
  }
}

/**
 * READ handler: rewrites oldName/newName on the way out so API consumers
 * get nested JSON instead of an escaped JSON string. Register this on the
 * service that exposes the AuditLog entity, e.g.:
 *
 *   const { attachAuditLogReadFormatter } = require("../common/utils/audit");
 *   attachAuditLogReadFormatter(this, "AuditLogs");
 */
function attachAuditLogReadFormatter(srv, entityName) {
  srv.after("READ", entityName, (data) => {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (!row) continue;
      if ("oldName" in row) row.oldName = parseAuditPayload(row.oldName);
      if ("newName" in row) row.newName = parseAuditPayload(row.newName);
    }
  });
}

module.exports = {
  registerAuditHooks,
  persistAudit,
  parseAuditPayload,
  attachAuditLogReadFormatter,
};