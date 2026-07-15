namespace ewms.db.attendance;

using {managed} from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

entity HolidayCalendar : managed {
    key ID : UUID;
    calendarCode : String(20);
    name : type.Name100;
    country : String(3);
    state : type.Name50;
    year : Integer;
    description : type.Description;
    status : enums.Status default 'Active';
}

