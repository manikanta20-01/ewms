const cds = require("@sap/cds");

module.exports = (srv) => {
  const entities = Object.keys(srv.entities);

  entities.forEach((entity) => {
    srv.after("CREATE", entity, async (data) => {
      console.log(`Created ${entity} : ${data.ID}`);
    });

    srv.after("UPDATE", entity, async (data) => {
      console.log(`Updated ${entity} : ${data.ID}`);
    });

    srv.after("DELETE", entity, async (data) => {
      console.log(`Deleted ${entity} : ${data.ID}`);
    });
  });
};

// ===================== AUTH ==========================

const TRANSACTIONAL = process.env.AUDIT_TRANSACTIONAL !== "false";

function sanitize(obj) {
  if (!obj) return null;
  const clone = { ...obj };
  delete clone.accountNumber;
  delete clone.panNumber;
  delete clone.monthlyCTC;
  delete clone.salary;
  return clone;
}

module.exports = async function persistAudit(
  req,
  action,
  entityName,
  oldVal,
  newVal,
) {
  const user = req.user ? req.user.id : "anonymous";
  const entry = {
    user,
    action,
    entityName,
    oldValue: JSON.stringify(sanitize(oldVal)),
    newValue: JSON.stringify(sanitize(newVal)),
  };

  if (TRANSACTIONAL) {
    await req.run(INSERT.into("ewms.db.common.AuditLogs").entries(entry));
  } else {
    try {
      await cds
        .tx({})
        .run(INSERT.into("ewms.db.common.AuditLogs").entries(entry));
    } catch (err) {
      console.error("Audit log persistence failed (non-blocking):", err);
    }
  }
};
