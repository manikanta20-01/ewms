// ============================================================
// SPRINT 23 - REPORTS & EXPORT (COMPUTED, BACKEND-ONLY)
// ------------------------------------------------------------
// Nine report types over the EXISTING module data. The metric
// logic reuses the Sprint 22 shared helpers
// (srv/common/utils/analytics-queries.js) plus the row builders
// in handlers/report-builders.js - the READ handlers and the
// ExportCSV action call the SAME builders, so a report and its
// export can never disagree.
//
// Every entity is @cds.persistence.skip (computed at read time,
// nothing stored, nothing stale). Filters are applied SERVER-SIDE:
//   * interactive reads honor OData $filter with the repo-wide
//     simple-filter convention + $top (paged, capped),
//   * the export carries the SAME filters as plain action
//     parameters (bound actions cannot take $filter, so the
//     typed parameters mirror each report's supported filters).
//
// Beginner notes on the APIs:
//   * GET  /odata/v4/reports/Workforce?$filter=department_ID eq ...
//   * POST /odata/v4/reports/ExportCSV  { "report": "Workforce",
//         "/...same filter fields/", "limit": 1000 }
//
// Privacy: these are HR/management reporting surfaces. THE ROWS
// ARE PERSONAL (employee names, attendance, documents), so plain
// employees and managers are denied every report here - their
// regular per-module services already give them their scoped
// views (documented decision in SPRINT-23.md). The stricter
// role map lives in reports-security.cds AND is re-checked in
// the handlers.
// ============================================================

service ReportsService @(requires: 'authenticated-user') {

    // All report types - one vocabulary for the export action.
    type ReportType : String enum {
        Workforce;
        Attendance;
        Leave;
        Recruitment;
        Performance;
        Asset;
        DocumentExpiry;
        Helpdesk;
        Exit;
    }

    // ------------------------------------------------------------

    // Employee master rows with the department from the LATEST
    // EmployeeHistory (the repo-wide rule). NO compensation, no
    // personal contact data - workforce structure only.
    @cds.persistence.skip entity Workforce {
        key employee_ID   : UUID;
            employeeCode  : String(20);
            firstName     : String(100);
            lastName      : String(100);
            employeeStatus: String(20);
            employmentType: String(30);
            joiningDate   : Date;
            department_ID : UUID;
            departmentName: String(100);
    }

    // Attendance rows (per employee/day). workedHours is the only
    // numeric measure; lateMinutes helps punctuality reviews.
    @cds.persistence.skip entity Attendance {
        key ID              : UUID;
            employee_ID     : UUID;
            employeeCode    : String(20);
            employeeName    : String(200);
            attendanceDate  : Date;
            attendanceStatus: String(30);
            workLocation    : String(30);
            workedHours     : Decimal(5, 2);
            lateMinutes     : Integer;
    }

    // Leave requests (dates NOT days-approval data beyond status
    // and totals - money/balance detail stays in the leave module).
    @cds.persistence.skip entity Leave {
        key ID           : UUID;
            leaveNumber  : String(20);
            employee_ID  : UUID;
            employeeCode : String(20);
            employeeName : String(200);
            leaveType_ID : UUID;
            leaveTypeCode: String(20);
            status       : String(30);
            fromDate     : Date;
            toDate       : Date;
            totalDays    : Decimal(5, 2);
    }

    // Recruitment funnel rows (aggregated counts - no candidate
    // names/emails/CTC anywhere).
    @cds.persistence.skip entity Recruitment {
        key kind : String(20);   // Candidate | Offer | OnboardingCase
        key stage: String(30);
            count: Integer;
    }

    // Performance review/goal stage counts (aggregated).
    @cds.persistence.skip entity Performance {
        key kind : String(10);   // Review | Goal
        key stage: String(30);
            count: Integer;
    }

    // Asset lines incl. the CURRENT holder from the ACTIVE
    // assignment (custody information - HR/finance only, as the
    // asset module's own grants).
    @cds.persistence.skip entity Asset {
        key ID              : UUID;
            assetTag        : String(30);
            assetName       : String(100);
            assetStatus     : String(20);
            categoryName    : String(100);
            holderEmployeeCode: String(20);
            holderName      : String(200);
            assignedOn      : Date;
            condition       : String(20);
    }

    // Documents with an expiry, SCHEDULED FEED of the Sprint 17
    // rule (reuses that rule verbatim). documentNumber is a
    // statutory ID - HR-only rows, masked in the CSV is not
    // enough, so the whole report is HR-only AND the number is
    // included only for HR (same line-of-sight as the document
    // module itself).
    @cds.persistence.skip entity DocumentExpiry {
        key ID             : UUID;
            employee_ID    : UUID;
            employeeCode   : String(20);
            employeeName   : String(200);
            documentType   : String(50);
            documentNumber : String(100);
            expiryDate     : Date;
            documentStatus : String(20); // Valid / Expiring / Expired / PendingVerification
            daysUntilExpiry: Integer;
    }

    // Helpdesk tickets aggregated by category/status/priority.
    // per-ticket data (subjects, requester names) stays out on
    // purpose - the helpdesk module owns those.
    @cds.persistence.skip entity Helpdesk {
        key category : String(30);
        key status   : String(30);
            priority : String(10);
            ticketCount: Integer;
    }

    // Exit cases aggregated by kind (Status / Type) + stage.
    // Reason text is SENSITIVE (Sprint 21): never reported here.
    @cds.persistence.skip entity Exit {
        key kind : String(8);    // Status | Type
        key stage: String(30);
            count: Integer;
    }

    // ------------------------------------------------------------
    // EXPORT (unbound action; typed parameters mirror the filters)
    // ------------------------------------------------------------
    // Returns the CSV TEXT for the chosen report + filters. Row
    // caps: interactive reads max 250 rows; exports max the
    // caller-requested limit (<= 10 000) - unbounded exports are
    // refused 413, never silently truncated (a silent cut could
    // produce a false "complete" report).
    action ExportCSV(
        report         : ReportType,
        department_ID  : UUID,
        employee_ID    : UUID,
        leaveType_ID   : UUID,
        status         : String(30),
        attendanceStatus: String(30),
        documentType   : String(50),
        documentStatus : String(20),
        priority       : String(10),
        category       : String(30),
        kind           : String(20),
        stage          : String(30),
        assetStatus    : String(20),
        exitType       : String(30),
        fromDate       : Date,
        toDate         : Date,
        limit          : Integer
    ) returns String;
}
