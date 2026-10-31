const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { hasRole } = require("../../common/auth/authorization");

// ============================================================
// SPRINT 19 - SHARED POLICY HELPERS
// ------------------------------------------------------------
// Small building blocks used by both handler files (lifecycle
// and acknowledgments). Kept dependency-free of business rules
// so the two files can evolve independently.
// ============================================================

const POLICY_ENTITY = "ewms.db.hr_policy.Policy";
const VERSION_ENTITY = "ewms.db.hr_policy.PolicyVersion";
const ACK_ENTITY = "ewms.db.hr_policy.PolicyAcknowledgment";

/** ISO date (YYYY-MM-DD) of "today" in server time. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function ownEmployeeId(req) {
  return req.user?.attr?.employeeId ?? req.user?.employeeId ?? null;
}

/** HR trio - policy authoring/reporting population. */
function isHR(req) {
  return hasRole(req, "HRExecutive", "HRAdmin", "SystemAdmin");
}

/** Authorized approvers for the policy lifecycle. */
function isApprover(req) {
  return hasRole(req, "HRAdmin", "SystemAdmin");
}

/**
 * Resolve an employee's organizational scope from EXISTING
 * relationships - no invented fields:
 *
 *   Employee -> latest EmployeeHistory row (highest
 *   effectiveDate) -> Department -> BusinessUnit -> Company
 *   and the department's Location.country.
 *
 * Returns { employee, department_ID, company_ID, country,
 * employmentType } or null when the employee row is missing.
 */
async function employeeScope(tx, employeeId) {
  if (!employeeId) return null;
  const employee = await tx.run(
    SELECT.one.from("ewms.db.employee.Employee").where({ ID: employeeId }),
  );
  if (!employee) return null;

  const history = await tx.run(
    SELECT.from("ewms.db.employee.EmployeeHistory")
      .where({ employee_ID: employeeId })
      .orderBy({ effectiveDate: "desc" }),
  );
  const latest = history[0];
  const department_ID = latest?.department_ID ?? null;

  let company_ID = null;
  let country = null;
  if (department_ID) {
    const dept = await tx.run(
      SELECT.one.from("ewms.db.organization.Department").where({ ID: department_ID }),
    );
    if (dept) {
      if (dept.location_ID) {
        const loc = await tx.run(
          SELECT.one.from("ewms.db.organization.Location").where({ ID: dept.location_ID }),
        );
        country = loc?.country ?? null;
      }
      if (dept.businessUnit_ID) {
        const bu = await tx.run(
          SELECT.one.from("ewms.db.organization.BusinessUnit").where({ ID: dept.businessUnit_ID }),
        );
        company_ID = bu?.company_ID ?? null;
      }
    }
  }

  return {
    employee,
    department_ID,
    company_ID,
    country,
    employmentType: employee.employmentType || "Permanent",
  };
}

/**
 * Does the policy apply to this employee scope? Every set axis
 * must match; null/default axes never restrict. String compares
 * on country are case-insensitive ("India" vs "india").
 */
function policyAppliesTo(policyRow, scope) {
  if (!scope) return false;
  if (policyRow.applicableEmploymentType && policyRow.applicableEmploymentType !== scope.employmentType) return false;
  if (policyRow.applicableCompany_ID && String(policyRow.applicableCompany_ID) !== String(scope.company_ID)) return false;
  if (policyRow.applicableCountry && String(policyRow.applicableCountry).toLowerCase() !== String(scope.country ?? "").toLowerCase()) return false;
  if (policyRow.applicableDepartment_ID && String(policyRow.applicableDepartment_ID) !== String(scope.department_ID)) return false;
  return true;
}

module.exports = {
  POLICY_ENTITY,
  VERSION_ENTITY,
  ACK_ENTITY,
  today,
  ownEmployeeId,
  isHR,
  isApprover,
  employeeScope,
  policyAppliesTo,
};
