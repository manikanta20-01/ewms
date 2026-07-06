using {ewms.db.project as db} from '../db/schema';

service ProjectService {
    entity Projects as projection on db.Project;
    entity ProjectManagers as projection on db.ProjectManager;
}

