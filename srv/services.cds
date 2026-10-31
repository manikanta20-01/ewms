using from './attendance/attendance-service';
using from './attendance/attendance-security';

using from './employee/employee-service';
using from './employee/employee-security';

using from './organization/organization-service';
using from './organization/organization-security';

using from './project/project-service';
using from './project/project-security';

using from './team/team-service';
using from './team/team-security';

using from './leave/leave-service';
using from './leave/leave-security';

using from './payroll/payroll-service';
using from './payroll/payroll-security';

// SPRINT 10 - Generic Workflow and Approval Engine
using from './workflow/workflow-service';
using from './workflow/workflow-security';

// SPRINT 11/12 - Notification extension point (minimal core)
using from './notification/notification-service';
using from './notification/notification-security';

// SPRINT 12 - Offer Letter + Onboarding (Recruitment)
using from './recruitment/recruitment-service';
using from './recruitment/recruitment-security';

// SPRINT 13 - Performance Management
using from './performance/performance-service';
using from './performance/performance-security';

// SPRINT 14 - Asset Management
using from './asset/asset-service';
using from './asset/asset-security';

// SPRINT 15 - Timesheet, Shift & Roster Integration
using from './timesheet/timesheet-service';
using from './timesheet/timesheet-security';

// SPRINT 16 - Geo Tracking & Geo-Fencing
using from './geo/geo-service';
using from './geo/geo-security';

// SPRINT 17 - Documents & Compliance
using from './compliance/compliance-service';
using from './compliance/compliance-security';

// SPRINT 18 - Employee Engagement
using from './engagement/engagement-service';
using from './engagement/engagement-security';

// SPRINT 19 - HR Policy Management
using from './hr-policy/hr-policy-service';
using from './hr-policy/policy-security';

// SPRINT 20 - HR Support / Helpdesk
using from './helpdesk/helpdesk-service';
using from './helpdesk/helpdesk-security';

// SPRINT 21 - Exit Management
using from './exit/exit-service';
using from './exit/exit-security';

// SPRINT 22 - Dashboard & Analytics (computed)
using from './dashboard/dashboard-service';
using from './dashboard/dashboard-security';

// SPRINT 23 - Reports & Export (computed + CSV export)
using from './reports/reports-service';
using from './reports/reports-security';

// SPRINT 24 - Background job control (admin-only)
using from './jobs/jobs-service';

// Temporary exposure for testing the AuditLog table in local SQLite
using { ewms.db.common as common } from '../db/common/audit-log';

extend service EmployeeService {
  @requires: 'SystemAdmin'
  entity AuditLogs as projection on common.AuditLog;
}