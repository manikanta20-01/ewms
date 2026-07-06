namespace ewms.db.team;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.project.Project} from '../project/project';

entity Team : managed {
    key ID : UUID;
    teamCode : type.BusinessCode;
    teamName : type.Name100;
    description : type.Description;
    project : Association to Project;
    status : enums.Status default 'Active';
}
