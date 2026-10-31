using AssetService from './asset-service';

// ============================================================
// SPRINT 14 - ASSET SECURITY (reuses Sprint 9 roles)
// ------------------------------------------------------------
// No new security framework. Design decisions:
//
//  * Asset MASTER data (categories + assets) is organizational
//    data: readable by HR/asset-admin roles and by anyone who is
//    or was a holder - but employees see only the assets they
//    CURRENTLY hold (row-level where on currentHolder).
//  * Assignment data is PERSONAL (who holds what, when, in which
//    condition): an employee sees only their OWN assignment rows;
//    managers see the assignments they created; HR/asset admins
//    see everything. A colleague's assignments are invisible
//    (404), exactly like performance data in Sprint 13.
//  * Lifecycle actions are asset/HR-admin work only - plain
//    employees can never assign/return/transfer/retire assets.
//  * Asset events (full history) are for asset/HR admins; the
//    personal view (own assignments incl. conditions) is enough
//    for employees and is what Sprint 21 Exit Management will
//    query per employee.
// ============================================================

annotate AssetService with @(requires: 'authenticated-user');

// Master data maintenance is admin work; every authenticated user
// may read the category list (needed for picklists).
annotate AssetService.AssetCategories with @restrict: [
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager', 'HRExecutive', 'HRAdmin', 'FinanceManager', 'PayrollExecutive', 'SystemAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRAdmin', 'SystemAdmin'] }
];

annotate AssetService.Assets with @restrict: [
    // HR / asset admins see all assets.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Everyone else only sees the assets they currently hold.
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager'],
      where: 'currentHolder_ID = $user.employeeId' },
    // Master data maintenance.
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // The whole lifecycle is asset/HR-admin work.
    { grant: ['assignAsset', 'returnAsset', 'transferAsset', 'inspectAsset',
              'startRepair', 'completeRepair', 'markLost', 'markDamaged',
              'retireAsset', 'disposeAsset'],
      to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

annotate AssetService.AssetAssignments with @restrict: [
    // HR / asset admins see all custody data.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] },
    // Employees see their OWN assignment history (this is exactly
    // the query Sprint 21 Exit Management will reuse per employee).
    { grant: ['READ'], to: ['Employee', 'DepartmentManager', 'ProjectManager'],
      where: 'employee_ID = $user.employeeId' },
    // The assigning manager sees the assignments they made.
    { grant: ['READ'], to: ['DepartmentManager', 'ProjectManager'],
      where: 'assignedBy_ID = $user.employeeId' },
    // Only the receiving employee confirms custody (own rows).
    { grant: ['AcknowledgeAssignment'], to: ['Employee', 'DepartmentManager', 'ProjectManager'],
      where: 'employee_ID = $user.employeeId' },
    { grant: ['AcknowledgeAssignment'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];

annotate AssetService.AssetEvents with @restrict: [
    // Full lifecycle history is asset/HR-admin information.
    { grant: ['READ'], to: ['HRExecutive', 'HRAdmin', 'SystemAdmin'] }
];
