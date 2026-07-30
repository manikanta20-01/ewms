using TeamService from './team-service';

annotate TeamService with @(requires: 'authenticated-user');

annotate TeamService.Teams with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CRUD'], to: ['ProjectManager','HRAdmin','SystemAdmin'] }
];
annotate TeamService.TeamManagers with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CRUD'], to: ['HRAdmin','SystemAdmin'] }
];