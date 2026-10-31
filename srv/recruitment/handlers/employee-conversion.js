const cds = require("@sap/cds");
const { SELECT, UPDATE, INSERT } = cds.ql;
const { persistAudit } = require("../../common/utils/audit");

// ============================================================
// SPRINT 12 - EMPLOYEE CONVERSION (IDEMPOTENT)
// ------------------------------------------------------------
// The final step of onboarding: the candidate becomes an employee
// in the EXISTING Employee Core (Sprint 4). Rules:
//
//   * NO second employee entity is created - this handler only
//     INSERTs into ewms.db.employee.Employee plus the active
//     EmployeeAssignment row.
//   * IDEMPOTENCY: the convertedEmployee association on the
//     onboarding case is the single source of truth for "already
//     converted". A second call NEVER creates a second employee.
//   * Conversion requires the case to be Completed, so the
//     mandatory task/document guards have already passed.
//   * Employee code uses the shared generateCode util
//     (EMP000001 numbering) - Sprint 4 numbering is preserved.
//   * If an employee with the candidate's email already exists,
//     that employee is linked instead of creating a duplicate
//     (defensive duplicate protection).
// ============================================================

// Handler REGISTRATION uses the short SERVICE entity name;
// every QUERY/UPDATE inside uses the full DB entity name -
// matching the leave module convention.
const CASE_ENTITY = "OnboardingCases";
const CASE_DB = "ewms.db.recruitment.OnboardingCase";
const OFFER_ENTITY = "ewms.db.recruitment.Offer";
const CANDIDATE_ENTITY = "ewms.db.recruitment.Candidate";
const EMPLOYEE_ENTITY = "ewms.db.employee.Employee";
const ASSIGNMENT_ENTITY = "ewms.db.employee.EmployeeAssignment";

/**
 * Creates (or links) the employee for a completed onboarding case.
 * Idempotent: safe to call multiple times.
 */
async function convertToEmployee(req, tx, onboardingCase) {
  // ---------------------------------------------------------
  // GUARD 1: already converted? Then this is a no-op - never a
  // duplicate. The association is set transactionally together
  // with the INSERT, so a failed run cannot leave a half state.
  // ---------------------------------------------------------
  if (onboardingCase.convertedEmployee_ID) {
    const existing = await tx.run(
      SELECT.one.from(EMPLOYEE_ENTITY)
        .where({ ID: onboardingCase.convertedEmployee_ID }),
    );
    if (existing) {
      return {
        employee: existing,
        created: false,
        message: `Employee already exists for this onboarding case (${existing.employeeCode}). No duplicate was created.`,
      };
    }
    // Association dangling (employee deleted externally): fall
    // through and re-create, then repair the link below.
  }

  const candidate = await tx.run(
    SELECT.one.from(CANDIDATE_ENTITY).where({ ID: onboardingCase.candidate_ID }),
  );
  if (!candidate) {
    req.error(404, "Candidate for this onboarding case no longer exists.");
    return null;
  }

  // ---------------------------------------------------------
  // GUARD 2: an employee with the same email already exists?
  // Link it instead of creating a second person record.
  // ---------------------------------------------------------
  let employee = candidate.email
    ? await tx.run(SELECT.one.from(EMPLOYEE_ENTITY).where({ email: candidate.email }))
    : null;

  if (employee) {
    await tx.run(
      UPDATE(CASE_DB)
        .set({ convertedEmployee_ID: employee.ID })
        .where({ ID: onboardingCase.ID }),
    );
    return {
      employee,
      created: false,
      message: `Existing employee ${employee.employeeCode} was linked to this onboarding case. No duplicate was created.`,
    };
  }

  // ---------------------------------------------------------
  // CREATE the employee through the existing Employee Core.
  // ---------------------------------------------------------
  const newEmployeeId = cds.utils.uuid();
  const employeeCode = await require("../../common/utils/code-generator")
    .generateCode(req, EMPLOYEE_ENTITY, "employeeCode", "EMP", 6);

  await tx.run(
    INSERT.into(EMPLOYEE_ENTITY).entries({
      ID: newEmployeeId,
      employeeCode,
      firstName: candidate.firstName,
      lastName: candidate.lastName || null,
      email: candidate.email || null,
      mobile: candidate.mobile || null,
      joiningDate: onboardingCase.plannedJoiningDate || null,
      totalExperience: candidate.experienceYears || 0,
      employmentType: "Permanent", // conservative default; HR can adjust
      status: "Active",
    }),
  );

  // Active assignment: department / designation / reporting
  // manager carried forward from the offer via the case.
  await tx.run(
    INSERT.into(ASSIGNMENT_ENTITY).entries({
      ID: cds.utils.uuid(),
      employee_ID: newEmployeeId,
      department_ID: onboardingCase.department_ID || null,
      designation_ID: onboardingCase.designation_ID || null,
      reportingManager_ID: onboardingCase.reportingManager_ID || null,
      fromDate: onboardingCase.plannedJoiningDate || new Date().toISOString().slice(0, 10),
      isActive: true,
    }),
  );

  // Mark the case as converted INSIDE the same transaction.
  await tx.run(
    UPDATE(CASE_DB)
      .set({ convertedEmployee_ID: newEmployeeId })
      .where({ ID: onboardingCase.ID }),
  );

  // Candidate journey ends here: Hired.
  await tx.run(
    UPDATE(CANDIDATE_ENTITY)
      .set({ status: "Hired" })
      .where({ ID: candidate.ID }),
  );

  return {
    employee: { ID: newEmployeeId, employeeCode },
    created: true,
    message: `Employee ${employeeCode} created from onboarding case ${onboardingCase.onboardingNumber}.`,
  };
}

/**
 * Normalizes the bound-action key predicate. req.params[0] may be
 * a RAW UUID string (CAP 8 bound actions) - it must be wrapped as
 * { ID } before .where() or CQN parses it as an expression.
 */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

module.exports = (srv) => {
  // HRAdmin/SystemAdmin only (recruitment-security.cds): creating
  // employee master data is a sensitive operation.
  srv.on("ConvertToEmployee", CASE_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const onboardingCase = await tx.run(
      SELECT.one.from(CASE_DB).where(keysOf(req)),
    );
    if (!onboardingCase) return req.error(404, "Onboarding case not found.");

    // Business rule: conversion only after the case is completed.
    if (onboardingCase.status !== "Completed") {
      return req.error(
        400,
        `Onboarding case is '${onboardingCase.status}'. It must be Completed before the candidate can be converted into an employee.`,
      );
    }
    // Cancelled cases must never convert (defensive second check).
    if (onboardingCase.status === "Cancelled") {
      return req.error(400, "A cancelled onboarding case cannot be converted.");
    }

    const offer = await tx.run(
      SELECT.one.from("ewms.db.recruitment.Offer").where({ ID: onboardingCase.offer_ID }),
    );

    const result = await convertToEmployee(req, tx, onboardingCase);
    if (!result) return; // error already emitted

    await persistAudit(req, "UPDATE", "OnboardingCases", onboardingCase, {
      convertedEmployee_ID: result.employee.ID,
      employeeCode: result.employee.employeeCode,
      created: result.created,
    });

    // Keep the offer aware that the journey finished (notes only -
    // the offer status stays 'Accepted', which is final).
    if (offer) {
      await tx.run(
        UPDATE(OFFER_ENTITY)
          .set({
            notes: `Employee ${result.employee.employeeCode} created via onboarding ${onboardingCase.onboardingNumber}.`,
          })
          .where({ ID: offer.ID }),
      );
    }

    return result.message;
  });
};
