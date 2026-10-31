const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { hasRole, hasGroup } = require("../../common/auth/authorization");
// Sprint 24: the reminder business logic now lives in ONE place
// (compliance-rules.js) so the background job layer and this
// action can never drift apart. The rules module imports the
// shared notification helper itself.
const {
  today,
  requirementApplies,
  computeLine,
  sendDocumentExpiryReminders,
} = require("./compliance-rules");

// ============================================================
// SPRINT 17 - COMPLIANCE SUMMARIES, LINES & REMINDER ACTION
// ------------------------------------------------------------
// Everything here is COMPUTED - the @cds.persistence.skip
// entities have no tables, so compliance status can never go
// stale: every read re-evaluates verification states, expiry
// dates and current requirement configuration.
//
// Line status rules (beginner-friendly):
//   no Active document of the required type ......... Missing
//   latest Active doc is  Pending ................. Pending
//   latest Active doc is  Rejected ................ Rejected
//   Verified & expiry < today ....................... Expired
//   Verified & expiry <= today + alertDays .......... Expiring
//   Verified & no expiry / expiry later ............ Compliant
//
// Summary status rules:
//   any mandatory line Expired OR Rejected ......... Overdue
//   else any mandatory Missing OR Pending .......... Incomplete
//   else ............................................ Compliant
//   (expiring warnings are informational - they do NOT
//    downgrade the summary status, they only count.)
//
// "A document exists" never equals "the employee is compliant":
// only HR-Verified documents whose requirement window applies
// and whose expiryDate has not passed satisfy a requirement.
// ============================================================

// Sprint 24: `today`, `addDays`, `requirementApplies` and
// `computeLine` moved to compliance-rules.js (imported above) -
// same rules, one implementation, zero behavior change.

/**
 * Extract the simple "columns = values" conditions from an OData
 * $filter CQN when the caller is doing simple client-side
 * filtering (e.g. employee_ID eq ...). The custom handler computes
 * rows itself, so CAP cannot apply server-side filters to it -
 * this keeps the common single-column filters working and stays
 * explicitly documented as best-effort.
 */
function simpleFilterValues(req) {
  const vals = {};
  const where = req.query?.SELECT?.where;
  if (Array.isArray(where)) {
    let op = "and";
    for (const part of where) {
      if (part === "and" || part === "or") {
        op = part;
        if (op === "or") break; // or-filters beyond the simple case
      } else if (
        part.ref?.[0] &&
        where[where.indexOf(part) + 1] === "=" &&
        where[where.indexOf(part) + 2]?.val !== undefined
      ) {
        vals[part.ref[0]] = where[where.indexOf(part) + 2].val;
      }
    }
  }
  return vals;
}

/**
 * Who may the caller see? HR trio + SystemAdmin see everyone;
 * a plain Employee is pinned to their own row (the security
 * where-clauses cannot be applied by CAP to skip-entities, so
 * this explicit scope check enforces them here). Managers get
 * NO compliance views by design.
 */
async function allowedEmployees(req, tx, filterValues) {
  if (hasRole(req, "HRExecutive", "HRAdmin", "SystemAdmin")) {
    const where = {};
    if (filterValues.employee_ID) where.ID = filterValues.employee_ID;
    return tx.run(
      SELECT.from("ewms.db.employee.Employee").where(where).columns("ID", "employeeCode", "firstName", "lastName", "employmentType", "status"),
    );
  }
  // Everyone else is self-service only - silently ignoring a
  // foreign employee_ID would INVISIBLY return another person's
  // data, so reject loudly instead.
  const own = req.user?.attr?.employeeId ?? req.user?.employeeId;
  if (filterValues.employee_ID && String(filterValues.employee_ID) !== String(own)) {
    if (hasGroup(req, "HR")) return; // unreachable, kept for clarity
    const e = new Error("You may only read your own compliance data.");
    e.status = 403;
    throw e;
  }
  if (!own) {
    const e = new Error("Your user is not linked to an employee record.");
    e.status = 403;
    throw e;
  }
  return tx.run(
    SELECT.from("ewms.db.employee.Employee").where({ ID: own }).columns("ID", "employeeCode", "firstName", "lastName", "employmentType", "status"),
  );
}

module.exports = (srv) => {
  const { ComplianceSummaries, ComplianceLines, ComplianceLines: LinesEntity } = srv.entities;

  // ----------------------------------------------------------
  // ComplianceSummaries (computed)
  // ----------------------------------------------------------
  srv.on("READ", ComplianceSummaries, async (req) => {
    const tx = cds.transaction(req);
    const filterValues = simpleFilterValues(req);

    const employees = await allowedEmployees(req, tx, filterValues);
    if (!employees.length) return [];

    const requirements = await tx.run(
      SELECT.from("ewms.db.compliance.DocumentRequirement").where({ status: "Active" }),
    );
    const allDocs = await tx.run(
      SELECT.from("ewms.db.employee.Document").where({ status: "Active" }),
    );

    const summaries = [];
    for (const employee of employees) {
      const applicable = requirements.filter((r) => requirementApplies(r, employee));
      const docs = allDocs.filter((d) => d.employee_ID === employee.ID);
      const lines = applicable.map((r) => computeLine(r, employee, docs));

      const mandatory = lines.filter((l) => l.isMandatory);
      const cnt = {
        compliant: lines.filter((l) => l.lineStatus === "Compliant").length,
        expiring: lines.filter((l) => l.lineStatus === "Expiring").length,
        expired: lines.filter((l) => l.lineStatus === "Expired").length,
        missing: lines.filter((l) => l.lineStatus === "Missing").length,
        pending: lines.filter((l) => l.lineStatus === "Pending").length,
        rejected: lines.filter((l) => l.lineStatus === "Rejected").length,
      };

      const mandStatus = mandatory.map((l) => l.lineStatus);
      let status = "Compliant";
      if (mandStatus.some((s) => s === "Expired" || s === "Rejected")) status = "Overdue";
      else if (mandStatus.some((s) => s === "Missing" || s === "Pending")) status = "Incomplete";

      summaries.push({
        employee_ID: employee.ID,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employmentType: employee.employmentType,
        totalRequirements: lines.length,
        mandatoryRequirements: mandatory.length,
        compliant: cnt.compliant,
        expiring: cnt.expiring,
        expired: cnt.expired,
        missing: cnt.missing,
        pendingVerification: cnt.pending,
        rejected: cnt.rejected,
        status,
      });
    }

    // Employment-type post filter (simplified semantics documented).
    if (filterValues.employmentType) {
      return summaries.filter((s) => s.employmentType === filterValues.employmentType);
    }
    // The conventional "missing/expired" drill-down filters:
    if (filterValues.status) {
      return summaries.filter((s) => s.status === filterValues.status);
    }
    return summaries;
  });

  // ----------------------------------------------------------
  // ComplianceLines (computed drill-down)
  // ----------------------------------------------------------
  srv.on("READ", ComplianceLines, async (req) => {
    const tx = cds.transaction(req);
    const filterValues = simpleFilterValues(req);

    const employees = await allowedEmployees(req, tx, filterValues);
    if (!employees.length) return [];

    const requirements = await tx.run(
      SELECT.from("ewms.db.compliance.DocumentRequirement").where({ status: "Active" }),
    );
    const docsFor = await tx.run(SELECT.from("ewms.db.employee.Document").where({ status: "Active" }));

    let lines = [];
    for (const employee of employees) {
      const applicable = requirements.filter((r) => requirementApplies(r, employee));
      lines.push(...applicable.map((r) => computeLine(r, employee, docsFor.filter((d) => d.employee_ID === employee.ID))));
    }

    if (filterValues.lineStatus) lines = lines.filter((l) => l.lineStatus === filterValues.lineStatus);
    if (filterValues.documentType) lines = lines.filter((l) => l.documentType === filterValues.documentType);
    if (filterValues.isMandatory !== undefined)
      lines = lines.filter((l) => String(l.isMandatory) === String(filterValues.isMandatory === "true" || filterValues.isMandatory === true));
    return lines;
  });

  // ----------------------------------------------------------------
  // NotifyDocumentExpiries - MANUAL reminder trigger (repeat-safe)
  // ----------------------------------------------------------------
  // Sprint 24: the reminder logic moved to compliance-rules.js where
  // the scheduler/CLI/job layer calls the SAME function. This action
  // now just validates its parameters and delegates. The behavior is
  // identical to before - the same dedupe rules (recipient + title +
  // business record) and the same notification content.
  srv.on("NotifyDocumentExpiries", async (req) => {
    const tx = cds.transaction(req);
    const daysBefore = Number(req.data.daysBefore);
    if (req.data.daysBefore != null && !(Number.isInteger(daysBefore) && daysBefore > 0)) {
      return req.reject(400, "daysBefore must be a positive whole number of days.");
    }
    const window = Number.isInteger(daysBefore) && daysBefore > 0 ? daysBefore : 30;

    const result = await sendDocumentExpiryReminders(tx, { window, now: today() });

    return `Reminder pass complete (window ${result.windowDays} days): ${result.docReminders} document reminders, ${result.missingReminders} missing-requirement reminders (duplicates suppressed).`;
  });
};
