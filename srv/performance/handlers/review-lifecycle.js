const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");
const { registerCallbacks } = require("../../workflow/handlers/business-callbacks");

// ============================================================
// SPRINT 13 - PERFORMANCE REVIEW LIFECYCLE
// ------------------------------------------------------------
// Implements the review state machine:
//
//   Draft -> PendingReview -> InReview -> Submitted
//         -> (generic workflow OR direct HR approval) -> Approved
//         -> Completed,  Cancelled as side exit.
//
// Design rules honored here:
//   * Approval reuses the Sprint 10 GENERIC workflow engine - no
//     second approval logic is built. Reviews use the seeded
//     WF-REVIEW-STD definition with businessObjectType
//     'ewms.db.performance.PerformanceReview'.
//   * Every state change writes an audit row (shared audit util)
//     and sends a notification through the SHARED notification
//     core - no new audit/notification infrastructure.
//   * Lifecycle actions are idempotent-safe: repeated calls on a
//     final state fail with a clear transition error instead of
//     silently changing anything.
// ============================================================

// NOTE (project convention): handler REGISTRATION uses the short
// SERVICE entity name; every QUERY/UPDATE inside uses the full DB
// entity name (see offer-lifecycle.js for the same pattern).
const REVIEW_ENTITY = "Reviews"; // service projection (registration only)
const REVIEW_DB = "ewms.db.performance.PerformanceReview"; // DB table (queries)
const EMPLOYEE_DB = "ewms.db.employee.Employee";
const INSTANCE_ENTITY = "ewms.db.workflow.WorkflowInstance";
const REVIEW_TYPE = "ewms.db.performance.PerformanceReview";

// Valid values of the shared 1-5 rating scale (db/common/enums.cds).
// Actions accept a plain String parameter, so the handler must
// validate it before storing it into the enum-typed column.
const VALID_RATINGS = [
  "Unsatisfactory",
  "NeedsImprovement",
  "MeetsExpectations",
  "ExceedsExpectations",
  "Outstanding",
];

// Statuses that freeze a review: no more edits of any kind.
const FROZEN_STATUSES = ["Approved", "Completed", "Cancelled"];

// ------------------------------------------------------------
// Allowed review status transitions. Everything not listed here
// is rejected with 400 - arbitrary status manipulation (e.g. via
// direct PATCH) can never happen.
// ------------------------------------------------------------
const REVIEW_TRANSITIONS = {
  Draft: ["PendingReview", "Cancelled"],
  PendingReview: ["InReview", "Cancelled"],
  InReview: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Cancelled"],
  Approved: ["Completed"], // finishing touch only
  Completed: [], // final
  Cancelled: [], // final
};

/** Validates one transition; returns an error response if invalid. */
function assertTransition(req, from, to) {
  const allowed = REVIEW_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Review cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/**
 * Normalizes the bound-action / bound-CRUD key predicate.
 * req.params[0] may be a RAW UUID string (bound actions, CAP 8) -
 * passing that into .where() makes CQN parse the UUID as an
 * arithmetic expression and crash. It must be wrapped as { ID }.
 */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

function isHr(req) {
  return req.user.is("HRExecutive") || req.user.is("HRAdmin") || req.user.is("SystemAdmin");
}

/**
 * Shared guard: the review must exist and must not be frozen.
 * Frozen reviews (Approved/Completed/Cancelled) are historical
 * records - even HR cannot rewrite them (audit integrity).
 */
async function loadMutableReview(req, tx) {
  const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
  if (!review) {
    req.error(404, "Performance review not found.");
    return null;
  }
  if (FROZEN_STATUSES.includes(review.status)) {
    req.error(400, `A '${review.status}' review is frozen and can no longer be modified.`);
    return null;
  }
  return review;
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // CREATE: auto review code, existence checks, date validation,
  // duplicate protection and the no-self-review rule.
  // ----------------------------------------------------------
  srv.before("CREATE", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);

    req.data.reviewCode = await generateCode(req, REVIEW_DB, "reviewCode", "REV", 4);
    if (!req.data.status) req.data.status = "Draft";

    // Employee and reviewer must exist - dangling reviews would
    // break the workflow start and every report built on them.
    if (!req.data.employee_ID) return req.error(400, "An employee is required for a review.");
    if (!req.data.reviewer_ID) return req.error(400, "A reviewer is required for a review.");

    const employee = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: req.data.employee_ID }));
    if (!employee) return req.error(404, "Employee (review subject) not found.");
    const reviewer = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: req.data.reviewer_ID }));
    if (!reviewer) return req.error(404, "Reviewer not found.");

    // A reviewer is always another person - self-reviews would
    // make the whole evaluation meaningless.
    if (req.data.employee_ID === req.data.reviewer_ID) {
      return req.error(400, "An employee cannot review their own performance.");
    }

    // Sensible dates: the period must end after it starts, and the
    // review must be due on/after the period start.
    const today = new Date().toISOString().slice(0, 10);
    if (req.data.periodStart && req.data.periodEnd && req.data.periodEnd < req.data.periodStart) {
      return req.error(400, "periodEnd cannot be before periodStart.");
    }
    const anchor = req.data.periodStart || req.data.startDate;
    if (req.data.dueDate && anchor && req.data.dueDate < anchor) {
      return req.error(400, "dueDate cannot be before the review/period start.");
    }
    if (req.data.startDate && req.data.startDate < today) {
      return req.error(400, "startDate cannot be in the past.");
    }

    // Duplicate protection: at most ONE open (non-final) review per
    // employee + type + identical period. Two parallel annual
    // reviews for the same period would produce contradictory
    // results; finished ones are fine (yearly cycles).
    if (req.data.periodStart && req.data.periodEnd) {
      const duplicates = await tx.run(
        SELECT.from(REVIEW_DB).where({
          employee_ID: req.data.employee_ID,
          reviewType: req.data.reviewType || "Annual",
          periodStart: req.data.periodStart,
          periodEnd: req.data.periodEnd,
        }),
      );
      if (duplicates.some((r) => !FROZEN_STATUSES.includes(r.status))) {
        return req.error(
          409,
          "An open review of this type already exists for this employee and period.",
        );
      }
    }
  });

  // ----------------------------------------------------------
  // READ: audit trail value - record who reads what is NOT done
  // here (too noisy); sensitive-field masking is unnecessary
  // because row-level @restrict already limits visibility.
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // UPDATE guard: direct edits may never bypass the lifecycle.
  // ----------------------------------------------------------
  srv.before("UPDATE", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");

    if (FROZEN_STATUSES.includes(review.status)) {
      return req.error(400, `A '${review.status}' review is frozen and can no longer be modified.`);
    }
    if (req.data.status && req.data.status !== review.status) {
      return req.error(
        400,
        "Review status changes must use the lifecycle actions (SubmitReview, StartReview, SubmitEvaluation, ApproveReview, CompleteReview, CancelReview).",
      );
    }
    // The overall rating may only be set while the review is being
    // evaluated (InReview) or handed over (Submitted) - never
    // silently from a plain PATCH in Draft.
    if (req.data.overallRating !== undefined && req.data.overallRating !== null) {
      if (!["InReview", "Submitted"].includes(review.status)) {
        return req.error(
          400,
          "overallRating can only be set in status InReview or Submitted (use SubmitEvaluation).",
        );
      }
      if (!VALID_RATINGS.includes(req.data.overallRating)) {
        return req.error(
          400,
          `Invalid rating '${req.data.overallRating}'. Valid values: ${VALID_RATINGS.join(", ")}.`,
        );
      }
    }
  });

  // ----------------------------------------------------------
  // Lifecycle actions
  // ----------------------------------------------------------

  // Draft -> PendingReview (+ start the generic workflow).
  srv.on("SubmitReview", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "PendingReview");

    // The workflow requester must be a real employee; sysadmin has
    // no Employee row, so fall back to the HR creator recorded on
    // the review (reviewer is always a real employee).
    const requesterId = req.user?.attr?.employeeId || review.reviewer_ID;

    await tx.run(UPDATE(REVIEW_DB).set({ status: "PendingReview" }).where({ ID: review.ID }));
    await persistAudit(req, "UPDATE", "Reviews", review, { status: "PendingReview" });

    // Notify the reviewer that their evaluation work begins now.
    await notify(cds.transaction(req), {
      recipientId: review.reviewer_ID,
      title: `Review ${review.reviewCode} assigned`,
      message: `You are the reviewer for review ${review.reviewCode}. Please start the evaluation.`,
      category: "PERFORMANCE",
      priority: "High",
      sourceModule: "PERFORMANCE",
      sourceEntity: "PerformanceReview",
      sourceRecordId: review.ID,
    });

    // Start the GENERIC workflow (engine throws 404 if no active
    // definition exists -> surfaced as a real error to the caller).
    const engine = require("../../workflow/handlers/workflow-engine");
    return engine.startWorkflow(req, {
      businessObjectType: REVIEW_TYPE,
      businessObjectId: review.ID,
      requesterId,
      summary: `Performance review ${review.reviewCode} approval`,
    });
  });

  // PendingReview -> InReview (reviewer / HR only, per security).
  srv.on("StartReview", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "InReview");

    await tx.run(UPDATE(REVIEW_DB).set({ status: "InReview" }).where({ ID: review.ID }));
    await persistAudit(req, "UPDATE", "Reviews", review, { status: "InReview" });
    return "Review started - the reviewer can now record the evaluation.";
  });

  // InReview -> Submitted: the reviewer hands in the evaluation.
  srv.on("SubmitEvaluation", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "Submitted");

    // Rating is mandatory for submitting an evaluation - a review
    // without an overall result would be an empty approval.
    const rating = req.data?.overallRating;
    if (!rating) {
      return req.error(400, "overallRating is required when submitting an evaluation.");
    }
    if (!VALID_RATINGS.includes(rating)) {
      return req.error(
        400,
        `Invalid rating '${rating}'. Valid values: ${VALID_RATINGS.join(", ")}.`,
      );
    }

    await tx.run(
      UPDATE(REVIEW_DB)
        .set({
          status: "Submitted",
          overallRating: rating,
          reviewerComments: req.data?.comments || review.reviewerComments,
          submittedAt: new Date().toISOString(),
        })
        .where({ ID: review.ID }),
    );

    await persistAudit(req, "UPDATE", "Reviews", review, {
      status: "Submitted",
      overallRating: rating,
    });
    return "Evaluation submitted. The review now awaits approval.";
  });

  // Employee comments on their OWN review (row-level @restrict
  // guarantees the where-clause; frozen reviews are rejected).
  srv.on("AddEmployeeComments", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await loadMutableReview(req, tx);
    if (!review) return;

    const me = req.user?.attr?.employeeId;
    if (!me || me !== review.employee_ID) {
      return req.error(403, "You can only comment on your own review.");
    }
    if (!req.data?.comments || !req.data.comments.trim()) {
      return req.error(400, "Comments cannot be empty.");
    }

    await tx.run(
      UPDATE(REVIEW_DB)
        .set({ employeeComments: req.data.comments })
        .where({ ID: review.ID }),
    );
    await persistAudit(req, "UPDATE", "Reviews", review, { employeeComments: "..." });
    return "Employee comments recorded.";
  });

  // Submitted -> Approved: HR direct-approval fallback, blocked
  // while a workflow instance is running (one authority at a time).
  srv.on("ApproveReview", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "Approved");

    const running = await tx.run(
      SELECT.one.from(INSTANCE_ENTITY).where({
        businessObjectType: REVIEW_TYPE,
        businessObjectId: review.ID,
        status: { in: ["Running", "Rework"] },
      }),
    );
    if (running) {
      return req.error(
        409,
        "A workflow instance is still running for this review. Approve through the workflow tasks.",
      );
    }

    await tx.run(UPDATE(REVIEW_DB).set({ status: "Approved" }).where({ ID: review.ID }));
    await persistAudit(req, "UPDATE", "Reviews", review, { status: "Approved" });

    await notify(cds.transaction(req), {
      recipientId: review.employee_ID,
      title: `Review ${review.reviewCode} approved`,
      message: `Your performance review ${review.reviewCode} was approved (overall rating: ${review.overallRating || "n/a"}).`,
      category: "PERFORMANCE",
      priority: "Medium",
      sourceModule: "PERFORMANCE",
      sourceEntity: "PerformanceReview",
      sourceRecordId: review.ID,
    });
    return "Review approved.";
  });

  // Approved -> Completed: freezes the review permanently.
  srv.on("CompleteReview", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "Completed");

    await tx.run(
      UPDATE(REVIEW_DB)
        .set({
          status: "Completed",
          finalComments: req.data?.finalComments || review.finalComments,
          completedAt: new Date().toISOString(),
        })
        .where({ ID: review.ID }),
    );
    await persistAudit(req, "UPDATE", "Reviews", review, { status: "Completed" });

    await notify(cds.transaction(req), {
      recipientId: review.employee_ID,
      title: `Review ${review.reviewCode} completed`,
      message: `Your performance review ${review.reviewCode} is now final.`,
      category: "PERFORMANCE",
      priority: "Low",
      sourceModule: "PERFORMANCE",
      sourceEntity: "PerformanceReview",
      sourceRecordId: review.ID,
    });
    return "Review completed.";
  });

  // Cancel from any non-final state (HR only, per security).
  srv.on("CancelReview", REVIEW_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const review = await tx.run(SELECT.one.from(REVIEW_DB).where(keysOf(req)));
    if (!review) return req.error(404, "Performance review not found.");
    assertTransition(req, review.status, "Cancelled");

    await tx.run(
      UPDATE(REVIEW_DB)
        .set({ status: "Cancelled" })
        .where({ ID: review.ID }),
    );
    await persistAudit(req, "UPDATE", "Reviews", review, { status: "Cancelled" });

    await notify(cds.transaction(req), {
      recipientId: review.employee_ID,
      title: `Review ${review.reviewCode} cancelled`,
      message: `Performance review ${review.reviewCode} was cancelled. ${req.data?.comments || ""}`.trim(),
      category: "PERFORMANCE",
      priority: "Medium",
      sourceModule: "PERFORMANCE",
      sourceEntity: "PerformanceReview",
      sourceRecordId: review.ID,
    });
    return "Review cancelled.";
  });

  // ----------------------------------------------------------
  // WORKFLOW CALLBACKS: sync the review when the generic workflow
  // for 'ewms.db.performance.PerformanceReview' finishes. The
  // workflow owns the APPROVAL state; this callback keeps the
  // business status consistent with it (single source of truth
  // for the review lifecycle remains this module).
  // ----------------------------------------------------------
  registerCallbacks(REVIEW_TYPE, {
    applyDecision: async (tx, instance, decision, comments) => {
      if (decision === "Approved") {
        // Workflow approved -> the review's evaluation result is
        // accepted. Idempotent: only moves Draft..Submitted rows.
        const review = await tx.run(
          SELECT.one.from(REVIEW_DB).where({ ID: instance.businessObjectId }),
        );
        if (review && !FROZEN_STATUSES.includes(review.status) && review.status !== "Approved") {
          await tx.run(
            UPDATE(REVIEW_DB).set({ status: "Approved" }).where({ ID: review.ID }),
          );
        }
      } else if (decision === "Rejected") {
        // The approver rejected the evaluation -> back to Draft so
        // HR/reviewer can correct and resubmit.
        await tx.run(
          UPDATE(REVIEW_DB)
            .set({ status: "Draft" })
            .where({ ID: instance.businessObjectId }),
        );
      } else if (decision === "Cancelled") {
        // HR cancelled the running workflow itself.
        await tx.run(
          UPDATE(REVIEW_DB)
            .set({ status: "Cancelled" })
            .where({ ID: instance.businessObjectId }),
        );
      }
      // 'Terminated' is reserved for admin intervention and
      // deliberately leaves the review untouched (same as Leave).
    },

    applyRework: async (tx, instance, comments) => {
      // SendBack returns the review to Draft for corrections.
      await tx.run(
        UPDATE(REVIEW_DB).set({ status: "Draft" }).where({ ID: instance.businessObjectId }),
      );
    },

    applyResubmit: async (tx, instance) => {
      // Resubmission puts the review back into the approval queue.
      await tx.run(
        UPDATE(REVIEW_DB)
          .set({ status: "PendingReview" })
          .where({ ID: instance.businessObjectId }),
      );
    },

    getTitle: async (tx, instance) => {
      const review = await tx.run(
        SELECT.one.from(REVIEW_DB).where({ ID: instance.businessObjectId }),
      );
      return review ? `Review ${review.reviewCode}` : instance.businessObjectId;
    },
  });
};
