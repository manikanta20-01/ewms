using from './organization/company';
using from './organization/business-unit';
using from './organization/department';
using from './organization/location';
using from './organization/department-hr';

using from './project/project';
using from './project/project-manager';

using from './team/team';
using from './team/team-manager';

using from './employee/employee';
using from './employee/designation';
using from './employee/grade';
using from './employee/employee-assignment';
using from './employee/employee-history';
using from './employee/bank';
using from './employee/document';
using from './employee/education';
using from './employee/experience';
using from './employee/statutory-detail';

using from './attendance/shift';
using from './attendance/attendance';
using from './attendance/holiday-calendar';
using from './attendance/holiday';
using from './attendance/overtime';
using from './attendance/shift-assignment';
using from './attendance/workSchedule';

// SPRINT 16 - Geo Tracking & Geo-Fencing (references Employee,
// Attendance and organization Location master data)
using from './geo/geo';

// SPRINT 17 - Documents & Compliance (requirement configuration;
// documents themselves stay in the employee domain)
using from './compliance/compliance';

// SPRINT 18 - Employee Engagement (surveys, suggestions, kudos)
using from './engagement/engagement';

// SPRINT 19 - HR Policy Management (policy identity, versions,
// employee acknowledgments; reuses Employee + Organization only)
using from './hr-policy/hr-policy';

// SPRINT 20 - HR Support / Helpdesk (tickets, comments, event
// history, configurable SLA targets; reuses Employee + Document)
using from './helpdesk/helpdesk';

// SPRINT 21 - Exit Management (separation cases, clearance
// checklist, linked exit documents, notice-period configuration;
// reuses Employee + Assignment + Asset + Document + workflow)
using from './exit/exit';

using from './leave/leave-type';
using from './leave/leave-request';
using from './leave/leave-policy';
using from './leave/leave-balance';
using from './leave/leave-approval';
using from './leave/approval-history';

using from './payroll/salary-component';
using from './payroll/salary-structure';
using from './payroll/salary-structure-item';
using from './payroll/employee-salary';
using from './payroll/payroll-period';
using from './payroll/payroll-process';
using from './payroll/payroll-detail';
using from './payroll/payslip';
using from './payroll/payroll-history';

// SPRINT 10 - Generic Workflow and Approval Engine
using from './workflow/workflow-definition';
using from './workflow/workflow-instance';

// SPRINT 11/12 - Notification extension point (minimal core)
using from './notification/notification';

// SPRINT 12 - Offer Letter + Onboarding
using from './recruitment/recruitment';

// SPRINT 13 - Performance Management
using from './performance/performance';

// SPRINT 14 - Asset Management
using from './asset/asset';

// SPRINT 15 - Timesheet, Shift & Roster Integration
using from './timesheet/timesheet';