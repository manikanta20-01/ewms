const cds = require("@sap/cds");
const { SELECT, UPDATE } = cds.ql;
const { generateCode } = require("../../common/utils/code-generator");
const { persistAudit } = require("../../common/utils/audit");
const { notify } = require("../../notification/handlers/notification-core");

// ============================================================
// SPRINT 13 - PERFORMANCE GOAL LIFECYCLE
// ------------------------------------------------------------
// Implements the goal state machine:
//
//   Draft -> Active -> Completed,  Cancelled as side exit.
//
// No workflow here on purpose: goals are managed by the assignee
// directly. Only the review approval uses the generic engine.
// Every state change writes an audit row and (where useful) a
// notification through the SHARED helpers.
// ============================================================

const GOAL_ENTITY = "Goals"; // service projection (registration only)
const GOAL_DB = "ewms.db.performance.PerformanceGoal"; // DB table (queries)
const REVIEW_DB = "ewms.db.performance.PerformanceReview";
const EMPLOYEE_DB = "ewms.db.employee.Employee";

// Same shared 1-5 scale as the review ratings.
const VALID_RATINGS = [
  "Unsatisfactory",
  "NeedsImprovement",
  "MeetsExpectations",
  "ExceedsExpectations",
  "Outstanding",
];

// Frozen goals may never be modified again.
const FROZEN_STATUSES = ["Completed", "Cancelled"];

const GOAL_TRANSITIONS = {
  Draft: ["Active", "Cancelled"],
  Active: ["Completed", "Cancelled"],
  Completed: [], // final
  Cancelled: [], // final
};

function assertTransition(req, from, to) {
  const allowed = GOAL_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return req.error(
      400,
      `Goal cannot move from '${from}' to '${to}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (final state)"
      }.`,
    );
  }
}

/** Raw-UUID-safe key extraction (CAP 8 bound actions - see
 *  offer-lifecycle.js for why this wrapper is mandatory). */
function keysOf(req) {
  const p = req.params?.[0];
  if (!p) return { ID: req.data?.ID };
  return typeof p === "object" ? p : { ID: p };
}

async function loadMutableGoal(req, tx) {
  const goal = await tx.run(SELECT.one.from(GOAL_DB).where(keysOf(req)));
  if (!goal) {
    req.error(404, "Performance goal not found.");
    return null;
  }
  if (FROZEN_STATUSES.includes(goal.status)) {
    req.error(400, `A '${goal.status}' goal is frozen and can no longer be modified.`);
    return null;
  }
  return goal;
}

module.exports = (srv) => {
  // ----------------------------------------------------------
  // CREATE: auto goal code, existence checks, weight validation,
  // due-date sanity, review-link validation.
  // ----------------------------------------------------------
  srv.before("CREATE", GOAL_ENTITY, async (req) => {
    const tx = cds.transaction(req);

    req.data.goalCode = await generateCode(req, GOAL_DB, "goalCode", "GOAL", 4);
    if (!req.data.status) req.data.status = "Draft";

    if (!req.data.employee_ID) return req.error(400, "An employee is required for a goal.");
    if (!req.data.assignedBy_ID) return req.error(400, "assignedBy is required for a goal.");

    const employee = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: req.data.employee_ID }));
    if (!employee) return req.error(404, "Employee (goal owner) not found.");
    const assigner = await tx.run(SELECT.one.from(EMPLOYEE_DB).where({ ID: req.data.assignedBy_ID }));
    if (!assigner) return req.error(404, "Assigning employee not found.");

    // Weight is a percentage contribution: must be within (0, 100].
    const weight = Number(req.data.weight ?? 0);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      return req.error(400, "Goal weight must be greater than 0 and at most 100.");
    }

    // A goal that is already overdue on the day it is created makes
    // no sense - reject obviously wrong dates early.
    const today = new Date().toISOString().slice(0, 10);
    if (req.data.dueDate && req.data.dueDate < today) {
      return req.error(400, "dueDate cannot be in the past.");
    }

    // If the goal is linked to a review, that review must exist and
    // belong to the same employee - goals of person A must never be
    // evaluated in a review of person B.
    if (req.data.review_ID) {
      const review = await tx.run(SELECT.one.from(REVIEW_DB).where({ ID: req.data.review_ID }));
      if (!review) return req.error(404, "Linked review not found.");
      if (review.employee_ID !== req.data.employee_ID) {
        return req.error(400, "The linked review must belong to the same employee as the goal.");
      }
    }
  });

  // ----------------------------------------------------------
  // UPDATE guard: no lifecycle bypass, weight re-validated,
  // frozen goals immutable.
  // ----------------------------------------------------------
  srv.before("UPDATE", GOAL_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const goal = await tx.run(SELECT.one.from(GOAL_DB).where(keysOf(req)));
    if (!goal) return req.error(404, "Performance goal not found.");

    if (FROZEN_STATUSES.includes(goal.status)) {
      return req.error(400, `A '${goal.status}' goal is frozen and can no longer be modified.`);
    }
    if (req.data.status && req.data.status !== goal.status) {
      return req.error(
        400,
        "Goal status changes must use the lifecycle actions (ActivateGoal, CompleteGoal, CancelGoal).",
      );
    }
    if (req.data.weight !== undefined) {
      const weight = Number(req.data.weight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
        return req.error(400, "Goal weight must be greater than 0 and at most 100.");
      }
    }
  });

  // ----------------------------------------------------------
  // Lifecycle actions
  // ----------------------------------------------------------

  // Draft -> Active.
  srv.on("ActivateGoal", GOAL_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const goal = await tx.run(SELECT.one.from(GOAL_DB).where(keysOf(req)));
    if (!goal) return req.error(404, "Performance goal not found.");
    assertTransition(req, goal.status, "Active");

    await tx.run(UPDATE(GOAL_DB).set({ status: "Active" }).where({ ID: goal.ID }));
    await persistAudit(req, "UPDATE", "Goals", goal, { status: "Active" });

    // Tell the goal owner their objective is now in force.
    await notify(cds.transaction(req), {
      recipientId: goal.employee_ID,
      title: `Goal ${goal.goalCode} activated`,
      message: `Goal '${goal.title}' is now active and due on ${goal.dueDate || "an open date"}.`,
      category: "PERFORMANCE",
      priority: "Medium",
      sourceModule: "PERFORMANCE",
      sourceEntity: "PerformanceGoal",
      sourceRecordId: goal.ID,
    });
    return "Goal activated.";
  });

  // Active -> Completed (records achievement + validated rating).
  srv.on("CompleteGoal", GOAL_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const goal = await tx.run(SELECT.one.from(GOAL_DB).where(keysOf(req)));
    if (!goal) return req.error(404, "Performance goal not found.");
    assertTransition(req, goal.status, "Completed");

    const rating = req.data?.rating;
    if (rating && !VALID_RATINGS.includes(rating)) {
      return req.error(400, `Invalid rating '${rating}'. Valid values: ${VALID_RATINGS.join(", ")}.`);
    }

    await tx.run(
      UPDATE(GOAL_DB)
        .set({
          status: "Completed",
          achievement: req.data?.achievement || goal.achievement,
          rating: rating || goal.rating,
          completedAt: new Date().toISOString(),
        })
        .where({ ID: goal.ID }),
    );
    await persistAudit(req, "UPDATE", "Goals", goal, {
      status: "Completed",
      rating: rating || null,
    });
    return "Goal completed.";
  });

  // Draft/Active -> Cancelled.
  srv.on("CancelGoal", GOAL_ENTITY, async (req) => {
    const tx = cds.transaction(req);
    const goal = await tx.run(SELECT.one.from(GOAL_DB).where(keysOf(req)));
    if (!goal) return req.error(404, "Performance goal not found.");
    assertTransition(req, goal.status, "Cancelled");

    await tx.run(UPDATE(GOAL_DB).set({ status: "Cancelled" }).where({ ID: goal.ID }));
    await persistAudit(req, "UPDATE", "Goals", goal, { status: "Cancelled" });
    return "Goal cancelled.";
  });
};
