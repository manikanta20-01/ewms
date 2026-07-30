const Roles = require("./roles");
const ROLE_GROUPS = require("./role-groups");

module.exports = {
  /**
   * True if the user has ANY of the given roles (or is SystemAdmin, who bypasses everything).
   * Usage: auth.hasRole(req, Roles.HR_ADMIN, Roles.HR_EXECUTIVE)
   */
  hasRole(req, ...roles) {
    if (!req.user) return false;
    if (req.user.is(Roles.SYSTEM_ADMIN)) return true;
    return roles.some((role) => req.user.is(role));
  },

  /**
   * True if the user has ANY role belonging to the named group (or is SystemAdmin).
   * Usage: auth.hasGroup(req, 'HR') / auth.hasGroup(req, 'PAYROLL')
   */
  hasGroup(req, groupName) {
    if (!req.user) return false;
    if (req.user.is(Roles.SYSTEM_ADMIN)) return true;

    const group = ROLE_GROUPS[groupName];
    if (!group) {
      throw new Error(`Unknown role group: "${groupName}"`);
    }
    return group.some((role) => req.user.is(role));
  },

  isSystemAdmin(req) {
    return !!req.user && req.user.is(Roles.SYSTEM_ADMIN);
  },
};
