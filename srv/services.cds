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

// Temporary exposure for testing the AuditLog table in local SQLite
using { ewms.db.common as common } from '../db/common/audit-log';

extend service EmployeeService {
  @requires: 'SystemAdmin'
  entity AuditLogs as projection on common.AuditLog;
}