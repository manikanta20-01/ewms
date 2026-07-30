const cds = require("@sap/cds");

const TTL_MS = Number(process.env.EMPLOYEE_CONTEXT_TTL_MS || 5 * 60 * 1000);
const cache = new Map();

async function lookupFromDb(iasUserId) {
  const db = await cds.connect.to("db");

  const appUser = await db.run(
    SELECT.one
      .from("ewms.db.common.AppUsers")
      .columns("employee_ID")
      .where({ iasUserId }),
  );
  if (!appUser?.employee_ID) return null;

  const employee = await db.run(
    SELECT.one
      .from("ewms.db.Employees")
      .columns("ID", "department_ID")
      .where({ ID: appUser.employee_ID }),
  );
  if (!employee) return null;

  return { employeeId: employee.ID, departmentId: employee.department_ID };
}

module.exports = {
  async resolve(iasUserId) {
    const cached = cache.get(iasUserId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        employeeId: cached.employeeId,
        departmentId: cached.departmentId,
      };
    }

    const resolved = await lookupFromDb(iasUserId);
    if (resolved) {
      cache.set(iasUserId, { ...resolved, expiresAt: Date.now() + TTL_MS });
    }
    return resolved;
  },

  invalidate(iasUserId) {
    cache.delete(iasUserId);
  },

  invalidateAll() {
    cache.clear();
  },
};
