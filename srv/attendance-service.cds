using {ewms.db.attendance as db} from '../db/schema';

service  AttendanceService {
    entity Attendances as projection on db.Attendance;
    entity Shifts as projection on db.Shift;
    entity Holidays as projection on db.Holiday;
    entity HolidayCalendars as projection on db.HolidayCalendar;
    entity Overtimes as projection on db.Overtime;
    entity ShiftAssignments as projection on db.ShiftAssignment;
    entity WorkSchedules as projection on db.WorkSchedule;
}

