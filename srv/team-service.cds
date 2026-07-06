using {ewms.db.team as db} from '../db/schema';

service TeamService {
    entity Teams as projection on db.Team;
    entity TeamManagers as projection on db.TeamManager;
}
