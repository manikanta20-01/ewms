using OrganizationService from './organization-service';

annotate OrganizationService with @(requires: 'authenticated-user');

annotate OrganizationService.Companies with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];
annotate OrganizationService.BusinessUnits with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];
annotate OrganizationService.Departments with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];
annotate OrganizationService.Locations with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','FinanceManager','PayrollExecutive','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];
annotate OrganizationService.DepartmentHRs with @restrict: [
  { grant: ['READ'], to: ['HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];