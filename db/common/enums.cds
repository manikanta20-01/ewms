namespace ewms.db.common;

// common status
type Status : String enum {
    Active;
    Inactive;
    Closed;
}

// Gender
type Gender : String enum {
    Male;
    Female;
}

// Marital Status
type MaritalStatus : String enum {
    Married;
    Single;
    Divorced;
    Widowed;
}

// Employee-Type
type EmploymentType : String enum {
    Permanent;
    Contract;
    Intern;
    Trainee;
    Consultant;
}

// Project Status
type ProjectStatus : String enum {
    Planning;
    Active;    
    Hold;
    Completed;
    Cancelled;
}

// Attendance Status
type AttendanceStatus : String enum {
    Present;
    Absent;
    Leave;
    Halfday;
    Holiday;
    WFH;
}

type LeaveType : String enum {
    Casual;
    Sick;
    Earned;
    Maternity;
    Paternity;
    LOP;
}


/*
 * Leave Status
 */

type LeaveStatus : String enum {
    Pending;
    TeamApproved;
    ProjectApproved;
    HRApproved;
    Rejected;
    Cancelled;
}


/*
 * Payroll Status
 */

type PayrollStatus : String enum {
    Draft;
    Processed;
    Paid;
}


/*
 * Asset Status
 */

type AssetStatus : String enum {
    Available;
    Assigned;
    Returned;
    Lost;
    Damaged;
}


/*
 * Interview Status
 */

type InterviewStatus : String enum {
    Scheduled;
    Completed;
    Selected;
    Rejected;
}

// ---------Currency-------
type CurrencyType : String enum {
    INR;
    USD;
    EUR;
}

type DocumentType : String enum {
    Aadhar;
    PAN;
    Passport;
    Resume;
    Degree;
    AllTypes;
}

type BloodGroup : String enum {
    A_Positive;
    A_Negative;
    B_Positive;
    B_Negative;
    AB_Positive;
    AB_Negative;
    O_Positive;
    O_Negative;
}

type AccountType : String enum {
    Savings;
    Current;
    Salary;
}

type QualificationType : String enum {
    SSC;
    HSC;
    Diploma;
    Bachelor;
    Master;
    Doctorate;
    Certification;
}

type WorkMode : String enum {
    Office;
    WFH;
    Onsite;
}