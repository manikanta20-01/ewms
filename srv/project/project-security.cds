using ProjectService from './project-service';

annotate ProjectService with @(requires: 'authenticated-user');

annotate ProjectService.Projects with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['ProjectManager','HRAdmin','SystemAdmin'] }
];
annotate ProjectService.ProjectManagers with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];