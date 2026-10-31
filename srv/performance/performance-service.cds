using { ewms.db.performance as db } from '../../db/schema';

// ============================================================
// SPRINT 13 - PERFORMANCE MANAGEMENT (SERVICE)
// ------------------------------------------------------------
// Exposes the performance lifecycle:
//
//   Reviews: CRUD + lifecycle actions (submit -> start -> evaluate
//   -> approve -> complete / cancel). Approval reuses the Sprint 10
//   generic workflow engine; the direct ApproveReview action is an
//   HR fallback blocked while a workflow instance is running.
//
//   Goals: CRUD + lifecycle actions (activate / complete / cancel).
//
// Standard OData V4 CRUD covers create/read/update; every STATE
// change goes through a dedicated action so that the transition
// rules in the handlers are always enforced. Security lives in
// performance-security.cds (Sprint 9 roles only).
// ============================================================

service PerformanceService @(requires: 'authenticated-user') {

    // ---------------------------------------------------------
    // PERFORMANCE REVIEWS with the full lifecycle as bound actions
    // ---------------------------------------------------------
    entity Reviews as projection on db.PerformanceReview actions {
        // Draft -> PendingReview. Starts the GENERIC workflow
        // (Sprint 10 engine) using the seeded WF-REVIEW-STD
        // definition (businessObjectType
        // 'ewms.db.performance.PerformanceReview').
        action SubmitReview() returns String;

        // PendingReview -> InReview. Only the assigned reviewer
        // (or HR) may start the review work.
        action StartReview() returns String;

        // InReview -> Submitted. The reviewer records the overall
        // rating (validated against the 1-5 PerformanceRating
        // scale) and their comments.
        action SubmitEvaluation(overallRating : String, comments : String(1000)) returns String;

        // Employee adds their own comments (own reviews only;
        // never on frozen reviews).
        action AddEmployeeComments(comments : String(1000)) returns String;

        // Submitted -> Approved. HR direct-approval fallback -
        // blocked while a workflow instance is running (the normal
        // path is approving the workflow task).
        action ApproveReview(comments : String(500)) returns String;

        // Approved -> Completed. Freezes the review.
        action CompleteReview(finalComments : String(1000)) returns String;

        // Cancel from any non-final state (HR only).
        action CancelReview(comments : String(500)) returns String;
    };

    // ---------------------------------------------------------
    // PERFORMANCE GOALS with their lifecycle as bound actions.
    // ---------------------------------------------------------
    entity Goals as projection on db.PerformanceGoal actions {
        // Draft -> Active.
        action ActivateGoal() returns String;

        // Active -> Completed. Records the achievement and the
        // (validated) goal rating.
        action CompleteGoal(achievement : String(500), rating : String) returns String;

        // Draft/Active -> Cancelled.
        action CancelGoal(comments : String(500)) returns String;
    };
}
