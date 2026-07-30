using ProjectService from './project-service';

annotate ProjectService with @(requires: 'authenticated-user');

annotate ProjectService.Projects with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CRUD'], to: ['ProjectManager','HRAdmin','SystemAdmin'] }
];
annotate ProjectService.ProjectManagers with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];