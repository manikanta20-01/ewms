using TeamService from './team-service';

annotate TeamService with @(requires: 'authenticated-user');

annotate TeamService.Teams with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['ProjectManager','HRAdmin','SystemAdmin'] }
];
annotate TeamService.TeamManagers with @restrict: [
  { grant: ['READ'], to: ['Employee','DepartmentManager','ProjectManager','HRExecutive','HRAdmin','SystemAdmin'] },
  { grant: ['CREATE','READ','UPDATE','DELETE'], to: ['HRAdmin','SystemAdmin'] }
];