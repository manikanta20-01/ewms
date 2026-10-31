const cds = require("@sap/cds");
const { SELECT } = cds.ql;

// ============================================================
// SPRINT 10 - STEP APPROVER RESOLUTION
// ------------------------------------------------------------
// The engine never hardcodes who approves what. For every step
// it calls resolveStepApprovers() which translates the step's
// approverType + approverValue into concrete assignees:
//
//   Position -> a fixed employee (approverValue = Employee UUID)
//   Role     -> a CAP role queue (approverValue = role name,
//               e.g. "HRExecutive"; any user with that role may
//               act on the task)
//   Manager  -> the requester's reporting manager, resolved
//               through the ACTIVE EmployeeAssignment (the same
//               source the Leave module already uses)
//   LevelHR  -> the department HR representative, resolved
//               through the ACTIVE DepartmentHR record
//               (same logic as the legacy leave flow)
//
// Returns an array because a later parallel-approval extension
// can return several assignees for one step.
// ============================================================

const EMPLOYEE_ENTITY = "ewms.db.employee.Employee";
const ASSIGNMENT_ENTITY = "ewms.db.employee.EmployeeAssignment";
const DEPARTMENT_HR_ENTITY = "ewms.db.organization.DepartmentHR";

/**
 * Finds the first active DepartmentHR record and returns the
 * employee row of the HR representative (or null).
 */
async function findDepartmentHR(tx) {
  const hrMapping = await tx.run(
    SELECT.one.from(DEPARTMENT_HR_ENTITY).where({ isActive: true }),
  );
  if (!hrMapping?.employee_ID) return null;

  return tx.run(
    SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: hrMapping.employee_ID }),
  );
}

/**
 * Finds the reporting manager (Employee row) of the given
 * requester based on their ACTIVE assignment, or null.
 */
async function findReportingManager(tx, requesterId) {
  const assignment = await tx.run(
    SELECT.one
      .from(ASSIGNMENT_ENTITY)
      .where({ employee_ID: requesterId, isActive: true }),
  );
  if (!assignment?.reportingManager_ID) return null;

  return tx.run(
    SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: assignment.reportingManager_ID }),
  );
}

/**
 * Resolves the assignee(s) of one workflow step.
 *
 * @param tx    - active database transaction
 * @param step  - WorkflowStep row
 * @param instance - WorkflowInstance row (needs requester_ID)
 * @returns [{ assigneeType, employeeId?, role?, name? }]
 */
async function resolveStepApprovers(tx, step, instance) {
  switch (step.approverType) {
    // ---------------------------------------------------------
    // Fixed person stored on the step configuration
    // ---------------------------------------------------------
    case "Position": {
      if (!step.approverValue) return [];
      const employee = await tx.run(
        SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: step.approverValue }),
      );
      if (!employee) return [];
      return [
        {
          assigneeType: "Position",
          employeeId: employee.ID,
          name: `${employee.firstName} ${employee.lastName}`,
        },
      ];
    }

    // ---------------------------------------------------------
    // Role queue: no concrete person, any user holding the role
    // may act (access enforced in the engine's task access check)
    // ---------------------------------------------------------
    case "Role": {
      if (!step.approverValue) return [];
      return [{ assigneeType: "Role", role: step.approverValue }];
    }

    // ---------------------------------------------------------
    // Requester's reporting manager (dynamic, per instance)
    // ---------------------------------------------------------
    case "Manager": {
      const manager = await findReportingManager(tx, instance.requester_ID);
      if (!manager) return [];
      return [
        {
          assigneeType: "Manager",
          employeeId: manager.ID,
          name: `${manager.firstName} ${manager.lastName}`,
        },
      ];
    }

    // ---------------------------------------------------------
    // Department HR representative (dynamic, per instance)
    // ---------------------------------------------------------
    case "LevelHR": {
      const hr = await findDepartmentHR(tx);
      if (!hr) return [];
      return [
        {
          assigneeType: "LevelHR",
          employeeId: hr.ID,
          name: `${hr.firstName} ${hr.lastName}`,
        },
      ];
    }

    default:
      return [];
  }
}

module.exports = {
  resolveStepApprovers,
  findDepartmentHR,
  findReportingManager,
};
