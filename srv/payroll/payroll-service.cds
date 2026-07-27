using { ewms.db.payroll as db } from '../../db/schema';

service PayrollService {
    // -----------------------------------------------------------------
    // Master Data Projections
    // -----------------------------------------------------------------
    entity SalaryComponents as projection on db.SalaryComponent;
    entity SalaryStructures as projection on db.SalaryStructure;
    entity SalaryStructureItems as projection on db.SalaryStructureItem;
    entity EmployeeSalaries as projection on db.EmployeeSalary;

    // -----------------------------------------------------------------
    // Transactional Projections & Enterprise Workflow Actions
    // -----------------------------------------------------------------
    entity PayrollPeriods as projection on db.PayrollPeriod actions {
        // Core Payroll Engine Trigger (Batch Run with LOP & OT)
        action ProcessPayroll(otRateMultiplier : Decimal(3,2)) returns String;
        
        // Batch Approval for all calculated records in period
        action ApprovePayrollBatch() returns String;
        
        // Lock and Unlock Period Safeguards
        action LockPayroll() returns String;
        action UnlockPayroll() returns String;
    };

    entity PayrollProcesses as projection on db.PayrollProcess actions {
        // Individual Exception Recalculation
        action RecalculatePayroll() returns String;
        action RejectPayroll(reason : String) returns String;
    };

    entity PayrollDetails as projection on db.PayrollDetail;

    entity Payslips as projection on db.Payslip actions {
        action PublishPayslip() returns String;
    };

    entity PayrollHistories as projection on db.PayrollHistory;
}