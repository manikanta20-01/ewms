using { cuid, managed } from '@sap/cds/common';

// ============================================================
// SPRINT 24 - BACKGROUND JOB CONTROL SERVICE
// ------------------------------------------------------------
// One admin-only surface for the job layer:
//
//   * RunJob          - run one registered job ON DEMAND
//                       (CLI, ops calls, tests - all the same
//                       validated path as the scheduler).
//   * JobRuns         - bounded IN-MEMORY history of the last
//                       runs in this process (no database table;
//                       design decision documented in
//                       SPRINT-24.md). Cleared on restart.
//
// SECURITY: the WHOLE service is SystemAdmin-only via
// @(requires:'SystemAdmin') plus the re-check in the handler -
// job execution and job history are never exposed to ordinary
// users (the job layer does not bypass row security anyway, but
// reading business-wide reminder results is admin work).
// ============================================================

service JobsService @(requires: 'SystemAdmin') {

    action RunJob(
        job        : String(50)  not null,  // registry job name
        windowDays : Integer,               // optional reminder window (job-defined)
        asOfDate   : Date                   // optional simulation date (YYYY-MM-DD)
    ) returns String;                        // flat summary (counts only)

    @cds.persistence.skip
    entity JobRuns {
        key runId      : String(50);
            job        : String(50);
            startedAt  : Timestamp;
            finishedAt : Timestamp;
            status     : String(20);
            summary    : String(1000);      // counts / sanitized failure summary
    }
}
