const cds = require("@sap/cds");

cds.on("bootstrap", (app) => {
  const seenThisSession = new Set();

  app.use(async (req, res, next) => {
    next();

    if (!req.user || !req.user.id) return;

    const iasUserId =
      req.user._req?.tokenInfo?.getPayload?.().sub || req.user.id;
    const sessionKey = `${iasUserId}:${req.sessionID || "na"}`;
    if (seenThisSession.has(sessionKey)) return;
    seenThisSession.add(sessionKey);

    try {
      const db = await cds.connect.to("db");
      await db.run(
        INSERT.into("ewms.db.common.LoginHistory").entries({
          iasUserId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          success: true,
        }),
      );

      await db.run(
        UPDATE("ewms.db.common.AppUsers")
          .set({ lastLoginAt: new Date().toISOString() })
          .where({ iasUserId }),
      );
    } catch (err) {
      console.error("Failed to record login history:", err);
    }
  });
});
