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
        @(requires: ['PayrollExecutive', 'SystemAdmin'])
        action ProcessPayroll(otRateMultiplier : Decimal(3,2)) returns String;

        @(requires: ['FinanceManager', 'SystemAdmin'])
        action ApprovePayrollBatch() returns String;

        @(requires: ['FinanceManager', 'SystemAdmin'])
        action LockPayroll() returns String;

        @(requires: ['SystemAdmin'])
        action UnlockPayroll() returns String;
    };
    

    entity PayrollProcesses as projection on db.PayrollProcess actions {
        // Individual Exception Recalculation
        @(requires: ['PayrollExecutive', 'SystemAdmin'])
        action RecalculatePayroll() returns String;

        @(requires: ['FinanceManager', 'SystemAdmin'])
        action RejectPayroll(reason : String) returns String;
    };

    entity PayrollDetails as projection on db.PayrollDetail;

    entity Payslips as projection on db.Payslip actions {
        @(requires: ['HRAdmin', 'SystemAdmin'])
        action PublishPayslip() returns String;
    };

    entity PayrollHistories as projection on db.PayrollHistory;
}