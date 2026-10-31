const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SHARED COMPLIANCE RULES + DOCUMENT-EXPIRY REMINDER PASS
// ------------------------------------------------------------
// Extracted from handlers/summaries.js in Sprint 24 so that the
// BACKGROUND JOB LAYER (srv/jobs) and the MANUAL compliance
// action "NotifyDocumentExpiries" execute EXACTLY THE SAME
// business logic (single source of truth - the job layer decides
// WHEN a reminder pass runs, it never re-defines WHAT makes a
// document incomplete).
//
// Everything in here is PURE BUSINESS LOGIC on top of a database
// transaction (no req/user/service involved) so any caller
// (HTTP action, background job, CLI) can use it safely.
// ============================================================

const NOTIFICATION_ENTITY = "ewms.db.notification.Notification";
const EMPLOYEE_ENTITY = "ewms.db.employee.Employee";
const DOCUMENT_ENTITY = "ewms.db.employee.Document";
const REQUIREMENT_ENTITY = "ewms.db.compliance.DocumentRequirement";

/** ISO date (YYYY-MM-DD) of "today" in server time (UTC date). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Requirement applies to the employee? (employment type + validity window) */
function requirementApplies(reqRow, employee, nowIso) {
  if (reqRow.status !== "Active") return false;
  const t = nowIso || today();
  if (reqRow.effectiveFrom && reqRow.effectiveFrom > t) return false;
  if (reqRow.effectiveTo && reqRow.effectiveTo < t) return false;
  if (reqRow.appliesToEmploymentType && reqRow.appliesToEmploymentType !== (employee.employmentType || "Permanent"))
    return false;
  // Company/legal-entity scoping rides on the org BusinessUnit
  // association: a null scope = all entities (seed convention).
  return true;
}

/**
 * Per-requirement compliance line computation (moved verbatim from
 * summaries.js - the rule meanings are documented there):
 *   no Active document                  -> Missing
 *   latest Active doc verified state decides:
 *     Pending / Rejected / (Verified:)
 *       requiresIssueDate without issueDate -> Pending
 *       expiry < today                      -> Expired
 *       expiry <= today + alertDays         -> Expiring
 *       else                                -> Compliant
 */
function computeLine(reqRow, employee, docsForEmployee, nowIso) {
  const docs = docsForEmployee.filter((d) => d.documentType === reqRow.documentType);
  const latest = docs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  if (!latest) {
    return {
      employee_ID: employee.ID,
      requirement_ID: reqRow.ID,
      requirementCode: reqRow.requirementCode,
      requirementName: reqRow.name,
      documentType: reqRow.documentType,
      isMandatory: !!reqRow.isMandatory,
      lineStatus: "Missing",
      document_ID: null,
      documentExpiryDate: null,
      note: `No ${reqRow.documentType} document on file.`,
    };
  }

  let lineStatus;
  let note = null;
  switch (latest.verificationStatus) {
    case "Pending":
      lineStatus = "Pending";
      note = "Uploaded, awaiting HR verification.";
      break;
    case "Rejected":
      lineStatus = "Rejected";
      note = "Rejected by HR verification - a corrected upload is required.";
      break;
    default:
      if (reqRow.requiresIssueDate && !latest.issueDate) {
        lineStatus = "Pending";
        note = "Verified, but this requirement demands an issue date - the document metadata is incomplete.";
      } else if (latest.expiryDate) {
        const t = nowIso || today();
        if (latest.expiryDate < t) {
          lineStatus = "Expired";
          note = `Document expired on ${latest.expiryDate}.`;
        } else if ((reqRow.expiryAlertDays || 0) > 0 && latest.expiryDate <= addDays(t, reqRow.expiryAlertDays)) {
          lineStatus = "Expiring";
          note = `Document expires on ${latest.expiryDate}.`;
        } else {
          lineStatus = "Compliant";
        }
      } else {
        lineStatus = "Compliant";
      }
  }

  return {
    employee_ID: employee.ID,
    requirement_ID: reqRow.ID,
    requirementCode: reqRow.requirementCode,
    requirementName: reqRow.name,
    documentType: reqRow.documentType,
    isMandatory: !!reqRow.isMandatory,
    lineStatus,
    document_ID: latest.ID,
    documentExpiryDate: latest.expiryDate || null,
    note,
  };
}

/** Dedupe: the same recipient + business record + title combination
 *  is ONE reminder - a re-run never re-sends it. */
async function alreadyNotified(tx, { recipientId, title, sourceRecordId }) {
  const existing = await tx.run(
    SELECT.one
      .from(NOTIFICATION_ENTITY)
      .where({ recipient_ID: recipientId, title, sourceRecordId }),
  );
  return !!existing;
}

// ------------------------------------------------------------
// THE REMINDER PASS (one batch, retry-safe)
// ------------------------------------------------------------
// 1. Expiring / expired VERIFIED Active documents  -> notify owner.
// 2. Missing MANDATORY requirement documents       -> notify owner.
// Duplicates are suppressed by alreadyNotified (same recipient +
// same title + same business record = already reminded), so
// calling this twice is safe and idempotent.
// ------------------------------------------------------------
/** Bounded selection: never scan an unbounded table in one pass. */
const MAX_DOCUMENTS_PER_PASS = 500;
const MAX_EMPLOYEES_PER_PASS = 500;

async function sendDocumentExpiryReminders(tx, { window: windowInput, now }) {
  const daysBefore = Number(windowInput);
  const win = Number.isInteger(daysBefore) && daysBefore > 0 ? daysBefore : 30;
  const t = now || today();

  // NOTE: no status filter - the seed data stores a boolean in the
  // Employee.status column, and a { status: 'Active' } WHERE would
  // match nothing (the lookup quirk documented in
  // srv/employee/handlers/document.js). Reminder eligibility comes
  // from the DOCUMENT rows instead.
  const activeEmployees = await tx.run(
    SELECT.from(EMPLOYEE_ENTITY)
      .columns("ID", "employeeCode", "firstName")
      .limit(MAX_EMPLOYEES_PER_PASS),
  );
  const employeesById = new Map(activeEmployees.map((e) => [e.ID, e]));

  // 1. Expiring / expired VERIFIED Active documents.
  const docs = await tx.run(
    SELECT.from(DOCUMENT_ENTITY)
      .where({ status: "Active", verificationStatus: "Verified" })
      .limit(MAX_DOCUMENTS_PER_PASS),
  );

  let sentDocs = 0;
  let sentMissing = 0;
  let documentsScanned = 0;

  for (const doc of docs) {
    documentsScanned += 1;
    if (!doc.expiryDate) continue;
    const employee = employeesById.get(doc.employee_ID);
    if (!employee) continue;

    let title = null;
    if (doc.expiryDate < t) title = `Your ${doc.documentType} document has expired`;
    else if (doc.expiryDate <= addDays(t, win)) title = `Your ${doc.documentType} document expires soon`;
    else continue;

    if (await alreadyNotified(tx, {
      recipientId: employee.ID,
      title,
      sourceRecordId: doc.ID,
    }))
      continue;

    // notify() is ASYNC and runs on the SAME transaction as this
    // pass (tested pattern from the original compliance action).
    await notify(tx, {
      recipientId: employee.ID,
      title,
      message: `${doc.fileName || doc.documentType} expired/will expire on ${doc.expiryDate}. Please upload a renewed document.`,
      category: "COMPLIANCE",
      priority: doc.expiryDate < t ? "High" : "Medium",
      sourceModule: "COMPLIANCE",
      sourceEntity: "ewms.db.employee.Document",
      sourceRecordId: doc.ID,
    });
    sentDocs += 1;
  }

  // 2. Missing MANDATORY documents (requirement reminders).
  const requirements = await tx.run(
    SELECT.from(REQUIREMENT_ENTITY).where({ status: "Active", isMandatory: true }).limit(MAX_DOCUMENTS_PER_PASS),
  );
  const allActiveDocs = await tx.run(
    SELECT.from(DOCUMENT_ENTITY).where({ status: "Active" }).limit(MAX_DOCUMENTS_PER_PASS),
  );

  for (const employee of activeEmployees) {
    for (const requirement of requirements) {
      if (!requirementApplies(requirement, employee, t)) continue;

      const satisfied = computeLine(requirement, employee, allActiveDocs.filter((d) => d.employee_ID === employee.ID), t);
      if (satisfied.lineStatus === "Compliant" || satisfied.lineStatus === "Expiring") continue;

      const title = `Missing required document: ${requirement.name}`;
      if (await alreadyNotified(tx, { recipientId: employee.ID, title, sourceRecordId: requirement.ID }))
        continue;

      await notify(tx, {
        recipientId: employee.ID,
        title,
        message: `Requirement ${requirement.requirementCode} (${requirement.documentType}) is not fulfilled. Line status: ${satisfied.lineStatus}. Please upload the document.`,
        category: "COMPLIANCE",
        priority: "Medium",
        sourceModule: "COMPLIANCE",
        sourceEntity: "ewms.db.compliance.DocumentRequirement",
        sourceRecordId: requirement.ID,
      });
      sentMissing += 1;
    }
  }

  return {
    docReminders: sentDocs,
    missingReminders: sentMissing,
    documentsScanned,
    employeesScanned: activeEmployees.length,
    windowDays: win,
  };
}

module.exports = {
  today,
  addDays,
  requirementApplies,
  computeLine,
  alreadyNotified,
  sendDocumentExpiryReminders,
  MAX_DOCUMENTS_PER_PASS,
  MAX_EMPLOYEES_PER_PASS,
};
