const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const auth = require("../../common/auth/authorization");

// ============================================================
// SPRINT 10 - WORKFLOW DELEGATION HANDLER
// ------------------------------------------------------------
// A delegation lets an approver hand their pending workflow work
// to a colleague for a date range. Hard rules (engine re-checks
// them again at approval time - see assertTaskAccess):
//
//   D1  You can only create delegations FROM yourself. Only
//       SystemAdmin may maintain delegations of other users.
//   D2  Delegator and delegate must be different employees.
//   D3  fromDate must be on or before toDate.
//   D4  The delegate must be an existing, active employee.
//   D5  Delegations are scoped: whole workflow world, one
//       definition, or exactly one task (task_ID wins).
// ============================================================

const EMPLOYEE_ENTITY = "ewms.db.employee.Employee";
const DELEGATION_ENTITY = "ewms.db.workflow.WorkflowDelegation";

module.exports = (srv) => {
  srv.before("CREATE", "WorkflowDelegations", async (req) => {
    const tx = cds.transaction(req);
    const { delegator_ID, delegate_ID, fromDate, toDate, task_ID, definition_ID } = req.data;

    // D1 - ownership of the delegator
    const me = req.user?.attr?.employeeId;
    if (me && delegator_ID && delegator_ID !== me && !auth.isSystemAdmin(req)) {
      return req.error(403, "You can only create delegations for yourself.");
    }

    // D2 - different people
    if (delegator_ID && delegator_ID === delegate_ID) {
      return req.error(400, "Delegator and delegate must be different employees.");
    }

    // D3 - chronological sanity
    if (fromDate && toDate && fromDate > toDate) {
      return req.error(400, "Delegation fromDate must be before or equal to toDate.");
    }

    // D4 - delegate must exist and be active
    if (delegate_ID) {
      const delegate = await tx.run(
        SELECT.one.from(EMPLOYEE_ENTITY).where({ ID: delegate_ID }),
      );
      if (!delegate) {
        return req.error(404, "Delegate employee does not exist.");
      }
      // Only an explicit 'Inactive' blocks delegation. (The seed
      // data historically stores other truthy values in
      // Employee.status, so we avoid an equality check on
      // 'Active' here.)
      if (delegate.status === "Inactive") {
        return req.error(400, "Delegate employee is not active.");
      }
    }

    // D5 - at most one scope narrowing entity is meaningful; task
    // wins if both are provided, which is allowed but flagged.
    if (task_ID && definition_ID) {
      req.info?.("Both task and definition provided; the task scope wins.");
    }
  });

  // Deactivating via status change is fine; historical delegations
  // may not be rewritten into other users' names.
  srv.before("UPDATE", "WorkflowDelegations", async (req) => {
    const me = req.user?.attr?.employeeId;
    if (auth.isSystemAdmin(req)) return;

    const targetId = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
    if (!targetId || !me) return;

    const tx = cds.transaction(req);
    const delegation = await tx.run(
      SELECT.one.from(DELEGATION_ENTITY).where({ ID: targetId }),
    );
    if (delegation && delegation.delegator_ID !== me) {
      return req.error(403, "You can only modify your own delegations.");
    }
    if ("delegator_ID" in (req.data || {}) && req.data.delegator_ID !== me) {
      return req.error(403, "The delegator of a delegation cannot be changed.");
    }
  });
};
