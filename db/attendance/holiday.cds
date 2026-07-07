namespace ewms.db.attendance;

using {managed} from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.attendance.HolidayCalendar} from './holiday-calendar';

entity Holiday : managed {
    key ID : UUID;
    holidayCalendar : Association to HolidayCalendar not null;
    name : type.Name100;
    holidayDate : Date;
    holidayType : enums.HolidayType default 'Festival';
    isOptional : Boolean default false;
    isPaidHoliday : Boolean default false;
    remarks : String(500);
    status : enums.Status default 'Active';
}