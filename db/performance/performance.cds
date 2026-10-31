namespace ewms.db.performance;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using { ewms.db.employee.Employee } from '../employee/employee';

// ============================================================
// SPRINT 13 - PERFORMANCE MANAGEMENT
// ------------------------------------------------------------
// This model covers employee performance reviews and the goals
// that are evaluated inside them:
//
//   PerformanceGoal  (Draft -> Active -> Completed)
//        |
//        | (optional link: which review evaluates this goal)
//        v
//   PerformanceReview (Draft -> PendingReview -> InReview
//        -> Submitted -> (generic workflow) -> Approved
//        -> Completed)
//
// IMPORTANT design decisions:
//   * Employee master data is NOT duplicated: both entities point
//     at the EXISTING Employee entity (Sprint 4/5) via
//     associations, so names/emails always come from one source.
//   * Review approval reuses the Sprint 10 GENERIC workflow engine
//     via businessObjectType 'ewms.db.performance.PerformanceReview'
//     - no second approval engine is built here.
//   * Goals are not copied into reviews: a review references the
//     employee's goals through the optional `review` association,
//     so goal data always lives in exactly one place.
// ============================================================

// ------------------------------------------------------------
// PERFORMANCE GOAL - one measurable objective for one employee
// ------------------------------------------------------------
// Goals can exist standalone (assigned by a manager or HR) and
// may later be referenced by a review that evaluates them.
// ------------------------------------------------------------
entity PerformanceGoal : managed {
    key ID : UUID;

    // Auto-generated reference, e.g. GOAL0001 (same code pattern
    // as OFF0001 / ONB0001 everywhere in EWMS).
    goalCode : String(20) @assert.unique;

    // WHOSE goal this is and WHO assigned it. Both are real
    // employees - no redundant name copies.
    employee   : Association to Employee not null;
    assignedBy : Association to Employee not null;

    // Optional link to the review that evaluates this goal.
    review : Association to PerformanceReview;

    title : type.Name100 not null;
    description : type.Description;

    // Free classification, e.g. 'Technical', 'Leadership', 'Delivery'.
    category : String(50);

    // Contribution of this goal to the overall evaluation in
    // percent. Validated in the handlers: must be > 0 and <= 100.
    weight : Decimal(5, 2) default 0;

    // WHAT success looks like and HOW it is measured.
    target : String(200);
    measurementCriteria : String(500);

    // When the goal must be achieved (validated: not in the past
    // on create - a goal that is already overdue makes no sense).
    dueDate : Date;

    // Draft -> Active -> Completed; Cancelled as side exit.
    status : enums.PerformanceGoalStatus default 'Draft';

    // Result data, filled when the goal is completed.
    achievement : String(500);
    rating : enums.PerformanceRating;

    employeeComments : String(1000);
    reviewerComments : String(1000);

    completedAt : Timestamp;
}

// ------------------------------------------------------------
// PERFORMANCE REVIEW - one evaluation of one employee
// ------------------------------------------------------------
// Lifecycle owner of the review status. Approval state itself is
// owned by the generic workflow engine; the two are synced by the
// callbacks in srv/performance/handlers/review-lifecycle.js.
// ------------------------------------------------------------
entity PerformanceReview : managed {
    key ID : UUID;

    // Auto-generated reference, e.g. REV0001.
    reviewCode : String(20) @assert.unique;

    // WHO is reviewed and WHO performs the review. The handler
    // forbids employee == reviewer (no self-review).
    employee : Association to Employee not null;
    reviewer : Association to Employee not null;

    // WHAT is being reviewed and for WHICH period.
    title : type.Name100;
    reviewType : enums.PerformanceReviewType default 'Annual';

    // The reviewed period. periodEnd must not be before periodStart.
    periodStart : Date;
    periodEnd   : Date;

    // When the review activity itself starts and when it is due.
    startDate : Date;
    dueDate   : Date;

    // Draft -> PendingReview -> InReview -> Submitted -> Approved
    // -> Completed (Cancelled as side exit; transitions enforced
    // in review-lifecycle.js).
    status : enums.PerformanceReviewStatus default 'Draft';

    // Overall result. Only settable in the InReview/Submitted
    // states and only with a valid rating value (see handlers).
    overallRating : enums.PerformanceRating;

    employeeComments : String(1000);
    reviewerComments : String(1000);
    finalComments    : String(1000);

    // Lifecycle bookkeeping.
    submittedAt : Timestamp;
    completedAt : Timestamp;

    // The employee's goals evaluated by this review (association
    // only - goal data is never duplicated into the review).
    goals : Association to many PerformanceGoal on goals.review = $self;
}
