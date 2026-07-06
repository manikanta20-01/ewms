using {ewms.db.employee as db} from '../db/schema';

service EmployeeService {
    entity Employees as projection on db.Employee;
    entity Designations as projection on db.Designation;
    entity Grades as projection on db.Grade;
    entity EmployeeAssignments as projection on db.EmployeeAssignment;
    entity EmployeeHistory as projection on db.EmployeeHistory;
    entity Banks as projection on db.Bank;
    entity Educations as projection on db.Education;
    entity Experiences as projection on db.Experience;
    entity Documents as projection on db.Document;
    entity StatutoryDetails as projection on db.StatutoryDetail;
}

