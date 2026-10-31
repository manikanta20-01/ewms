// ============================================================
// SPRINT 22 - DASHBOARD & ANALYTICS (COMPUTED, BACKEND-ONLY)
// ------------------------------------------------------------
// Every entity below is COMPUTED AT READ TIME
// (@cds.persistence.skip = there is NO stored table): a custom
// handler aggregates the EXISTING module tables and returns rows.
// That is deliberately different from Sprint 20's OverdueTickets
// idea applied wider - the dashboard can never go stale and no
// new "metric table" is ever written.
//
// ALL metric logic lives in the shared
//   srv/common/utils/analytics-queries.js
// module - the Sprint 23 Reports/Export service reuses EXACTLY
// these functions, so the two surfaces can never disagree.
//
// Privacy: every row is an AGGREGATE - no personal data, no
// salary, no reason text. Still, dashboards are a management
// view: readers must hold HR / management roles (dash-style
// grant AND handler re-check, like the helpdesk reporting).
//
// Filters intentionally do NOT exist here (site-wide view with
// fixed meaning). Sprint 23 adds filters on the same data.
// ============================================================

service DashboardService @(requires: 'authenticated-user') {

    // Workforce by employee master status (Active / Inactive ...).
    @cds.persistence.skip entity WorkforceStatus {
        key status        : String(30);
            employeeCount : Integer;
    }

    // Active-assignment headcount per department (COUNT DISTINCT
    // employees - one row can never be counted twice).
    @cds.persistence.skip entity HeadcountByDepartment {
        key department_ID     : UUID;
            departmentName    : String(100);
            activeHeadcount   : Integer;
            inactiveHeadcount : Integer;
    }

    // Leave usage per TYPE for the LeaveType-Vocabulary table
    // (approved = HRApproved; totalApprovedDays sums HRApproved days).
    @cds.persistence.skip entity LeaveTypeUsage {
        key leaveType_ID        : UUID;
            leaveTypeCode       : String(20);
            leaveTypeName       : String(100);
            totalRequests       : Integer;
            inProgressRequests  : Integer;
            approvedRequests    : Integer;
            rejectedRequests    : Integer;
            cancelledRequests   : Integer;
            totalApprovedDays   : Decimal(10, 2);
    }

    // Attendance rows per AttendanceStatus (whole history).
    @cds.persistence.skip entity AttendanceByStatus {
        key attendanceStatus : String(30);
            occurrenceCount  : Integer;
    }

    // Recruitment funnel: one row per source (Candidate / Offer /
    // OnboardingCase) + its status vocabulary stage.
    @cds.persistence.skip entity RecruitmentFunnel {
        key source : String(20);
        key stage  : String(30);
            count  : Integer;
    }

    // Performance reviews / goals by lifecycle stage.
    @cds.persistence.skip entity PerformanceStatus {
        key source : String(10);
        key stage  : String(30);
            count  : Integer;
    }

    // Asset lifecycle (per AssetStatus) + ACTIVE assignment count.
    @cds.persistence.skip entity AssetSummary {
        key source : String(12);   // 'Asset' or 'Assignment'
        key stage  : String(30);
            count  : Integer;
    }

    // Helpdesk tickets by status and by priority.
    @cds.persistence.skip entity HelpdeskSummary {
        key source : String(10);   // 'Status' or 'Priority'
        key stage  : String(30);
            count  : Integer;
    }

    // Exit cases by status and by exit type.
    @cds.persistence.skip entity ExitSummary {
        key source : String(8);    // 'Status' or 'Type'
        key stage  : String(30);
            count  : Integer;
    }

    // Active documents per type + the Sprint 17 expiry rule
    // (expiring = inside the CONFIGURED alert window, never a
    // hardcoded default; no configured window = no "expiring").
    @cds.persistence.skip entity DocumentExpiryOverview {
        key documentType       : String(50);
            activeDocuments    : Integer;
            expiringDocuments  : Integer;
            expiredDocuments   : Integer;
    }
}
