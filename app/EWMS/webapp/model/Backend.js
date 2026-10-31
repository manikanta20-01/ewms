sap.ui.define([
  "ewms/EWMS/model/Config"
], function (Config) {
  "use strict";

  // ============================================================
  // Sprint 26 - LOCAL DEVELOPMENT ONLY session + data facade.
  // ------------------------------------------------------------
  // CAP runs with mocked authentication ("kind": "mocked") in the
  // dev profile: each configured user authenticates via HTTP Basic
  // (any password is accepted; only the user name matters). This
  // module picks the local dev user and attaches the Basic header
  // to every OData request it makes.
  //
  // IMPORTANT: this "little sign-in" is a DEV convenience so the
  // browser can exercise the real backend roles. It is NOT a
  // security feature: authorization always comes from the CAP
  // backend (@restrict / @requires). Production will replace this
  // with the real identity provider (XSUAA / IAS) - see SPRINT-26.md.
  //
  // Data access uses plain XHR against the actual OData V4
  // services (same origin - no proxy needed). Failures REJECT:
  // views show a real error state; there is no silent fallback to
  // fake data anywhere in this app.
  // ============================================================

  const LOCAL_SESSION_KEY = "ewms.devUser"; // dev-only session pick

  // Mirrors package.json "cds.requires.auth.users". Kept in one
  // place and labelled dev-only; roles text is informational.
  const MOCK_USERS = [
    { id: "sysadmin", label: "System Admin",    roles: "SystemAdmin, HRAdmin, FinanceManager", note: "Full read incl. job execution" },
    { id: "hrperson", label: "HR (Executive/Admin)", roles: "HRExecutive, HRAdmin",        note: "HR data incl. all employees" },
    { id: "empjohn",  label: "John (Employee)", roles: "Employee",                             note: "only own records" },
    { id: "mgrdept",  label: "Dept. Manager",   roles: "DepartmentManager",                    note: "department-scoped reads" },
    { id: "mgrproj",  label: "Project Manager", roles: "ProjectManager",                       note: "project-scoped reads" },
    { id: "finmgr",   label: "Finance Manager", roles: "FinanceManager",                       note: "finance-scoped reads" },
    { id: "payexec",  label: "Payroll Executive", roles: "PayrollExecutive",                   note: "payroll-scoped reads" }
  ];

  // Employee.status is enums.Status (Active/Inactive/Closed/Pending).
  // The current seed CSVs still carry the legacy boolean "true"
  // values from an earlier schema version, which surface as "1"/"true".
  const STATUS_LABELS = {
    Active: "Active", Inactive: "Inactive", Closed: "Closed", Pending: "Pending",
    "1": "Active (legacy seed value)", "true": "Active (legacy seed value)"
  };

  let oSession = null; // { user, authHeader }

  function _authHeaderFor(sUserId) {
    // Basic with any password: CAP mocked auth only reads the user.
    return "Basic " + btoa(sUserId + ":");
  }

  function _statusForXHR() {
    if (!oSession) {
      throw new Error("No backend session. Sign in first.");
    }
    return oSession.authHeader;
  }

  // Single, honest JSON XHR against the real service.
  function _xhrJson(sUrl) {
    return new Promise(function (resolve, reject) {
      const oReq = new XMLHttpRequest();
      oReq.open("GET", sUrl, true);
      oReq.setRequestHeader("Authorization", _statusForXHR());
      oReq.addEventListener("load", function () {
        if (oReq.status === 200) {
          try { resolve(JSON.parse(oReq.responseText)); }
          catch (e) { reject(new Error("Backend returned invalid JSON")); }
        } else if (oReq.status === 401) {
          reject(new Error("Not authorized (HTTP 401). The backend rejected this identity."));
        } else {
          let sMsg = "";
          try { sMsg = JSON.parse(oReq.responseText).error?.message || ""; } catch (e) { /* keep empty */ }
          reject(new Error(`Backend request failed (HTTP ${oReq.status}).${sMsg ? " " + sMsg : ""}`));
        }
      });
      oReq.addEventListener("error", function () {
        reject(new Error("Network error - the backend OData service is not reachable."));
      });
      oReq.send();
    });
  }

  // ------------------------------------------------------------
  // Sprint 28 - write helpers (POST create, PATCH update, POST
  // bound action). Same honest error shaed as above: backend texts
  // are shown as-is, there is no silent success substitution.
  // ------------------------------------------------------------

  /** OData V4 POST (create). Resolves (never fakes) on 2xx with the
   *  created entity JSON (CAP returns 201 with the new row). */
  function _postJson(sUrl, mBody) {
    return new Promise(function (resolve, reject) {
      const oReq = new XMLHttpRequest();
      oReq.open("POST", sUrl, true);
      oReq.setRequestHeader("Authorization", _statusForXHR());
      oReq.setRequestHeader("Content-Type", "application/json");
      oReq.addEventListener("load", function () {
        if (oReq.status === 201 || oReq.status === 200) {
          try { resolve(oReq.responseText ? JSON.parse(oReq.responseText) : {}); }
          catch (e) { reject(new Error("Backend returned invalid JSON")); }
        } else {
          reject(new Error(_shortErr(oReq)));
        }
      });
      oReq.addEventListener("error", function () {
        reject(new Error("Network error - the backend OData service is not reachable."));
      });
      oReq.send(JSON.stringify(mBody || {}));
    });
  }

  /** OData V4 PATCH (update). CAP replies 204 No Content on success. */
  function _patchJson(sUrl, mBody) {
    return new Promise(function (resolve, reject) {
      const oReq = new XMLHttpRequest();
      oReq.open("PATCH", sUrl, true);
      oReq.setRequestHeader("Authorization", _statusForXHR());
      oReq.setRequestHeader("Content-Type", "application/json");
      oReq.addEventListener("load", function () {
        if (oReq.status === 204 || oReq.status === 200) {
          resolve(true);
        } else {
          reject(new Error(_shortErr(oReq)));
        }
      });
      oReq.addEventListener("error", function () {
        reject(new Error("Network error - the backend OData service is not reachable."));
      });
      oReq.send(JSON.stringify(mBody || {}));
    });
  }

  /** Bound action: POST /<Entity>(<id>)/<ActionName>. */
  function _postAction(sService, sEntity, sId, sAction, mParams) {
    return new Promise(function (resolve, reject) {
      const sUrl = _sService(sService) + sEntity + "(" + sId + ")/" + sAction;
      const oReq = new XMLHttpRequest();
      oReq.open("POST", sUrl, true);
      oReq.setRequestHeader("Authorization", _statusForXHR());
      oReq.setRequestHeader("Content-Type", "application/json");
      oReq.addEventListener("load", function () {
        if (oReq.status === 200 || oReq.status === 204) {
          try { resolve(oReq.responseText ? JSON.parse(oReq.responseText) : {}); }
          catch (e) { resolve({ message: oReq.responseText }); }
        } else {
          reject(new Error(_shortErr(oReq)));
        }
      });
      oReq.addEventListener("error", function () {
        reject(new Error("Network error - the backend OData service is not reachable."));
      });
      oReq.send(JSON.stringify(mParams || {}));
    });
  }

  /** Short, human-safe backend error text (no stack traces). */
  function _shortErr(oReq) {
    let sMsg = "";
    try { sMsg = JSON.parse(oReq.responseText).error?.message || ""; }
    catch (e) { /* not JSON, keep empty */ }
    if (oReq.status === 401) { sMsg = "Not authorized (HTTP 401)."; }
    return `Backend request failed (HTTP ${oReq.status}).${sMsg ? " " + sMsg : ""}`;
  }

  function _sEmployeeService() {
    return Config.getServiceURL("employee");
  }

  function _sService(sName) {
    return Config.getServiceURL(sName);
  }

  // ------------------------------------------------------------
  // Sprint 27 - generic list/read helpers
  // ------------------------------------------------------------
  // Replaces duplicated query-string builders per service. Every
  // screen reuses these; all paths come from Config (relative URLs,
  // no hardcoded hosts) and errors always REJECT so views show the
  // real state — never a silent fallback to fake data.
  function _buildQueryString(mQuery) {
    const aParts = [];
    for (const [sKey, vValue] of Object.entries(mQuery)) {
      if (vValue === undefined || vValue === null || vValue === "") { continue; }
      aParts.push(sKey + "=" + encodeURIComponent(vValue));
    }
    return aParts.length ? "?" + aParts.join("&") : "";
  }

  /**
   * Paged list from any served entity.
   * @returns {Promise<{rows:Array, count:number|null}>}
   */
  function _readList(sService, sEntity, mOpts) {
    mOpts = mOpts || {};
    const mQuery = {
      "$top": mOpts.top,
      "$skip": mOpts.skip,
      "$count": mOpts.count === false ? undefined : "true",
      "$select": mOpts.select,
      "$expand": mOpts.expand,
      "$orderby": mOpts.orderby,
      "$filter": mOpts.filter
    };
    if (mOpts.search) { mQuery["$search"] = `"${mOpts.search.replace(/"/g, "")}"`; }
    const sUrl = _sService(sService) + sEntity + _buildQueryString(mQuery);
    return _xhrJson(sUrl).then(function (oResult) {
      // $count=true returns @odata.count; without top it is the total.
      return { rows: oResult.value || [], count: oResult["@odata.count"] ?? null };
    });
  }

  function _sEmployeesQuery(mQuery) {
    const aParts = [];
    for (const [sKey, vValue] of Object.entries(mQuery)) {
      if (vValue === undefined || vValue === null || vValue === "") { continue; }
      aParts.push(sKey + "=" + encodeURIComponent(vValue));
    }
    return _sEmployeeService() + "Employees" + (aParts.length ? "?" + aParts.join("&") : "");
  }

  // ============================================================
  // Sprint 28 - attendance-domain data layer
  // ------------------------------------------------------------
  // Every helper below works exactly like the Sprint 27 reads: real
  // same-origin OData calls, backend-injected filtering, and honest
  // rejections. Writes use the REAL backend surface: POST for
  // create, PATCH for supported corrections, POST /<Entity>(<id>)/
  // <Action> for the bound lifecycle actions (timesheet). Nothing
  // here invents endpoints - entity names mirror the srv/*.cds
  // projections and the actions mirror the service CDS definitions.
  // ============================================================

  /** DELETE (rare, draft-only item edits). CAP replies 204. */
  function _deleteJson(sUrl) {
    return new Promise(function (resolve, reject) {
      const oReq = new XMLHttpRequest();
      oReq.open("DELETE", sUrl, true);
      oReq.setRequestHeader("Authorization", _statusForXHR());
      oReq.addEventListener("load", function () {
        if (oReq.status === 204 || oReq.status === 200) { resolve(true); }
        else { reject(new Error(_shortErr(oReq))); }
      });
      oReq.addEventListener("error", function () {
        reject(new Error("Network error - the backend OData service is not reachable."));
      });
      oReq.send();
    });
  }

  // Human-friendly vocabulary for the enum labels shown on screen.
  // Values stay identical to the server enums; only display text
  // gains a space ("InReview" -> "In review").
  const LABELS = {
    // attendance
    Present: "Present", Absent: "Absent", HalfDay: "Half day",
    Leave: "Leave", Holiday: "Holiday", WeekOff: "Week off",
    WorkFromHome: "Work from home", OnDuty: "On duty",
    Office: "Office",
    // leave
    Draft: "Draft", Pending: "Pending approval",
    TeamApproved: "Team approved", ProjectApproved: "Project approved",
    HRApproved: "HR approved", Rejected: "Rejected", Cancelled: "Cancelled",
    Approved: "Approved", FirstHalf: "First half", SecondHalf: "Second half",
    // timesheet
    Submitted: "Submitted", InReview: "In review",
    // geo
    CheckIn: "Check-in", CheckOut: "Check-out",
    Passed: "Passed", Bypassed: "Bypassed"
  };

  return {

    /** Restore the persisted dev-user pick (if any). */
    restore: function () {
      const sId = window.localStorage.getItem(LOCAL_SESSION_KEY);
      if (!sId) { return null; }
      const oUser = MOCK_USERS.find(function (oU) { return oU.id === sId; });
      if (oUser) { oSession = { user: oUser, authHeader: _authHeaderFor(sId) }; }
      return oUser || null;
    },

    getSession: function () { return oSession; },

    getMockUsers: function () { return MOCK_USERS; },

    signIn: function (sUserId) {
      const oUser = MOCK_USERS.find(function (oU) { return oU.id === sUserId; });
      if (!oUser) { throw new Error("Unknown dev user: " + sUserId); }
      oSession = { user: oUser, authHeader: _authHeaderFor(sUserId) };
      window.localStorage.setItem(LOCAL_SESSION_KEY, sUserId);
      return oUser;
    },

    signOut: function () {
      oSession = null;
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
    },

    /**
     * Paged employees list from the real OData service.
     * Optional $filter fragments (employmentType / status).
     * @returns {Promise<{rows:Array, count:number}>} rejects with Error; never returns fake rows.
     */
    readEmployees: function (mOptions) {
      const mQuery = {
        "$top": mOptions.top,
        "$skip": mOptions.skip,
        "$count": "true",
        "$select": "employeeCode,firstName,lastName,email,mobile,employmentType,workMode,status",
        "$orderby": "employeeCode"
      };
      // SERVER-SIDE filtering: the backend decides what the role sees;
      // the UI never filters what it is not allowed to receive.
      const aFilters = [];
      if (mOptions.employmentType) { aFilters.push(`employmentType eq '${mOptions.employmentType.replace(/'/g, "")}'`); }
      if (mOptions.status) { aFilters.push(`status eq '${mOptions.status.replace(/'/g, "")}'`); }
      if (aFilters.length) { mQuery["$filter"] = aFilters.join(" and "); }
      if (mOptions.search) { mQuery["$search"] = `"${mOptions.search.replace(/"/g, "")}"`; }
      return _xhrJson(_sEmployeesQuery(mQuery)).then(function (oResult) {
        return { rows: oResult.value || [], count: oResult["@odata.count"] ?? (oResult.value || []).length };
      });
    },

    // ============================================================
    // Sprint 27 - organization / project / team reads
    // ============================================================

    /** Paged departments (HR roles only per backend @restrict). */
    readDepartments: function (mOptions) {
      return _readList("organization", "Departments", {
        top: mOptions.top,
        skip: mOptions.skip,
        search: mOptions.search,
        select: "departmentCode,departmentName,description,status,businessUnit_ID,location_ID",
        orderby: "departmentCode",
        // businessUnit/location stay in the organization service, so
        // this expand is allowed by the model (same-service assoc).
        expand: "businessUnit($select=businessUnitCode,businessUnitName),location($select=locationCode,locationName)"
      });
    },

    /** One department + its parent organization references. */
    readDepartmentDetail: function (sId) {
      const sUrl = _sService("organization") + "Departments(" + sId + ")" +
        _buildQueryString({
          "$select": "departmentCode,departmentName,description,status,businessUnit_ID,location_ID",
          "$expand": "businessUnit($select=businessUnitCode,businessUnitName),location($select=locationCode,locationName,country,city)"
        });
      return _xhrJson(sUrl);
    },

    /** Paged projects (readable by every role). */
    readProjects: function (mOptions) {
      return _readList("project", "Projects", {
        top: mOptions.top,
        skip: mOptions.skip,
        search: mOptions.search,
        select: "projectCode,projectName,clientName,status,plannedStartDate,plannedEndDate,department_ID",
        orderby: "projectCode"
      });
    },

    /** One project (all listed fields are readable per backend grants). */
    readProjectDetail: function (sId) {
      const sUrl = _sService("project") + "Projects(" + sId + ")";
      return _xhrJson(sUrl);
    },

    /** Teams of one project (team service, key filter). */
    readTeamsOfProject: function (sProjectId) {
      return _readList("team", "Teams", {
        select: "teamCode,teamName,description,status",
        orderby: "teamCode",
        filter: "project_ID eq " + sProjectId
      });
    },

    /** Projects of one department (project service, key filter). */
    readProjectsOfDepartment: function (sDeptId) {
      return _readList("project", "Projects", {
        select: "projectCode,projectName,clientName,status" + "",
        orderby: "projectCode",
        filter: "department_ID eq " + sDeptId
      });
    },

    /** Paged teams (readable by every role). */
    readTeams: function (mOptions) {
      return _readList("team", "Teams", {
        top: mOptions.top,
        skip: mOptions.skip,
        search: mOptions.search,
        select: "teamCode,teamName,description,status,project_ID",
        orderby: "teamCode"
      });
    },

    /** One team. */
    readTeamDetail: function (sId) {
      const sUrl = _sService("team") + "Teams(" + sId + ")";
      return _xhrJson(sUrl);
    },

    /**
     * Members of one team: assignment rows joined with employee /
     * designation. HR/manager roles only (backend @restrict decides).
     * @returns {Promise<{rows:Array}>}
     */
    readTeamMembers: function (sTeamId) {
      return _readList("employee", "EmployeeAssignments", {
        select: "fromDate,toDate,isActive",
        orderby: "fromDate",
        filter: "team_ID eq " + sTeamId,
        top: 100,
        expand: "employee($select=employeeCode,firstName,lastName),designation($select=designationName),grade($select=gradeName)"
      });
    },

    /**
     * Assignments of one employee incl. project/team IDs (Sprint 27).
     * The project/team names are joined client-side via the lookup
     * below, because CAP does not expose cross-service navigation.
     */
    readEmployeeDetail: function (sId) {
      const sDetailUrl = _sEmployeeService() +
        "Employees(" + sId + ")?" + _buildQueryString({
          "$expand": "assignments($select=fromDate,toDate,isActive,project_ID,team_ID;$expand=designation($select=designationCode,designationName),grade($select=gradeCode,gradeName),reportingManager($select=employeeCode,firstName,lastName))"
        });
      return _xhrJson(sDetailUrl);
    },

    /**
     * Restriction-aware department lookup: resolves department IDs
     * to {ID -> "CODE Name"}. Departments are HR-role data; when the
     * acting role gets 403 the map is simply EMPTY (UI shows "—"),
     * never an invented name. NOT a mock fallback.
     */
    organizationsByIds: function (asIds) {
      if (!asIds || !asIds.length) {
        return Promise.resolve({});
      }
      const sFilter = asIds.map(function (id) { return "ID eq " + id; }).join(" or ");
      return _readList("organization", "Departments", {
        top: 100,
        select: "departmentCode,departmentName",
        filter: sFilter
      }).then(function (o) {
        const mMap = {};
        (o.rows || []).forEach(function (r) {
          mMap[r.ID] = `${r.departmentCode} ${r.departmentName}`;
        });
        return mMap;
      }).catch(function () {
        return {}; // 403/other -> empty map, UI shows "—"
      });
    },

    /**
     * Restriction-aware project/team name lookups for IDs referenced
     * by employee assignments. Projects and Teams are readable by all
     * signed-in roles, but failures still resolve to empty maps so
     * the UI shows "—" instead of inventing values.
     */
    refsByName: function (asProjectIds, asTeamIds) {
      function mapOf(sService, sEntity, sCodeField, sNameField, asIds) {
        if (!asIds || !asIds.length) { return Promise.resolve({}); }
        const sFilter = asIds.map(function (id) { return "ID eq " + id; }).join(" or ");
        return _readList(sService, sEntity, {
          top: 100,
          select: sCodeField + "," + sNameField,
          filter: sFilter
        }).then(function (o) {
          const mMap = {};
          (o.rows || []).forEach(function (r) {
            mMap[r.ID] = r[sCodeField] + " " + r[sNameField];
          });
          return mMap;
        }).catch(function () {
          return {};
        });
      }
      return Promise.all([
        mapOf("project", "Projects", "projectCode", "projectName", asProjectIds),
        mapOf("team", "Teams", "teamCode", "teamName", asTeamIds)
      ]).then(function (a) { return { projects: a[0], teams: a[1] }; });
    },

    /**
     * Display label for backend enum values. Unknown values render
     * as "—" or the raw value - never an invented status.
     */
    label: function (vValue) {
      if (vValue === undefined || vValue === null || vValue === "") { return "—"; }
      return LABELS[vValue] || vValue;
    },

    /** Restriction-aware employee lookup (ID -> "CODE Name").
     *  On 403 (plain-employee role beyond own row) resolves empty;
     *  the UI renders "—" for unknown co-workers. NOT a mock. */
    readEmployeeMap: function (asIds) {
      if (!asIds || !asIds.length) { return Promise.resolve({}); }
      const sFilter = asIds.map(function (id) { return "ID eq " + id; }).join(" or ");
      return _readList("employee", "Employees", {
        top: 100,
        select: "employeeCode,firstName,lastName",
        filter: sFilter
      }).then(function (o) {
        const mMap = {};
        (o.rows || []).forEach(function (r) {
          mMap[r.ID] = r.employeeCode + " " + r.firstName + " " + r.lastName;
        });
        return mMap;
      }).catch(function () { return {}; });
    },

    // ----------------------------------------------------------
    // Attendance (service /odata/v4/attendance)
    // ----------------------------------------------------------
    readAttendances: function (mOpts) {
      return _readList("attendance", "Attendances", {
        top: mOpts.top, skip: mOpts.skip,
        select: "attendanceDate,checkIn,checkOut,workLocation,workedHours,lateMinutes,attendanceStatus,remarks,employee_ID,shift_ID",
        orderby: "attendanceDate desc",
        filter: mOpts.filter
      });
    },

    readAttendanceDetail: function (sId) {
      return _xhrJson(_sService("attendance") + "Attendances(" + sId + ")?" +
        _buildQueryString({
          "$select": "attendanceDate,checkIn,checkOut,workLocation,workedHours,lateMinutes,earlyLeavingMinutes,attendanceStatus,remarks,employee_ID,shift_ID",
          "$expand": "shift($select=shiftCode,name,startTime,endTime)"
        }));
    },

    /** Check-in = POST with shift-free payload; the backend resolves
     *  the shift and computes lateMinutes (srv/attendance/handlers).
     *  Optional coordinates run the real geofence validation. */
    createAttendance: function (mBody) {
      return _postJson(_sService("attendance") + "Attendances", mBody);
    },

    /** Supported correction surface: PATCH of a whitelisted field set. */
    updateAttendance: function (sId, mBody) {
      return _patchJson(_sService("attendance") + "Attendances(" + sId + ")", mBody);
    },

    /** Evidence rows written by the geofence validator (read-only). */
    readAttendanceLocationEvents: function (sAttendanceId) {
      return _readList("geo", "AttendanceLocationEvents", {
        select: "eventType,result,latitude,longitude,distanceMeters,reason,eventTimestamp",
        filter: "attendance_ID eq " + sAttendanceId,
        orderby: "eventTimestamp desc"
      });
    },

    // ----------------------------------------------------------
    // Leave (service /odata/v4/leave)
    // ----------------------------------------------------------
    readLeaveRequests: function (mOpts) {
      return _readList("leave", "LeaveRequests", {
        top: mOpts.top, skip: mOpts.skip,
        select: "leaveNumber,fromDate,toDate,totalDays,halfDay,reason,status,employee_ID,leaveType_ID",
        orderby: "fromDate desc",
        filter: mOpts.filter,
        expand: "leaveType($select=leaveCode,name)"
      });
    },

    readLeaveRequestDetail: function (sId) {
      return _xhrJson(_sService("leave") + "LeaveRequests(" + sId + ")?" +
        _buildQueryString({
          "$select": "leaveNumber,fromDate,toDate,totalDays,halfDay,halfDayType,reason,status,remarks,employee_ID,leaveType_ID,appliedOn",
          "$expand": "leaveType($select=leaveCode,name,isPaid),approvals"
        }));
    },

    /** Filing a leave request - real POST; backend computes
     *  leaveNumber, appliedOn, totalDays and creates approval rows. */
    createLeaveRequest: function (mBody) {
      return _postJson(_sService("leave") + "LeaveRequests", mBody);
    },

    readLeaveTypes: function () {
      return _readList("leave", "LeaveTypes", {
        select: "leaveCode,name,isPaid,maxDaysPerRequest",
        orderby: "leaveCode"
      });
    },

    /** Leave balances exist for own rows (employees) / all (HR). */
    readLeaveBalances: function () {
      return _readList("leave", "LeaveBalances", {
        select: "year,allocatedDays,usedDays,pendingDays,employee_ID,leaveType_ID",
        orderby: "year desc",
        expand: "leaveType($select=leaveCode,name)"
      });
    },

    /** Approval = PATCH of the LeaveApproval stage row (decision);
     *  the backend routes level 1 -> level 2 and writes balances. */
    updateLeaveApproval: function (sId, mBody) {
      return _patchJson(_sService("leave") + "LeaveApprovals(" + sId + ")", mBody);
    },

    /** Append-only audit of approval actions (HR/manager roles). */
    readApprovalHistories: function (sLeaveRequestId) {
      return _readList("leave", "ApprovalHistories", {
        select: "action,performedOn,remarks,performedBy_ID",
        orderby: "performedOn desc",
        filter: "leaveRequest_ID eq " + sLeaveRequestId
      });
    },

    // ----------------------------------------------------------
    // Timesheet (service /odata/v4/timesheet)
    // ----------------------------------------------------------
    readTimesheets: function (mOpts) {
      return _readList("timesheet", "Timesheets", {
        top: mOpts.top, skip: mOpts.skip,
        select: "timesheetCode,periodFromDate,periodToDate,regularHours,overtimeHours,status,employee_ID,assignedManager_ID",
        orderby: "periodFromDate desc",
        filter: mOpts.filter
      });
    },

    readTimesheetDetail: function (sId) {
      return _xhrJson(_sService("timesheet") + "Timesheets(" + sId + ")?" +
        _buildQueryString({
          "$select": "timesheetCode,periodFromDate,periodToDate,regularHours,overtimeHours,status,submittedOn,reviewedOn,reviewerComments,employee_ID,assignedManager_ID",
          "$expand": "items($select=workDate,startTime,endTime,breakHours,regularHours,overtimeHours,notes,employeeAssignment_ID,shift_ID,project_ID)"
        }));
    },

    /** Create a reporting-period sheet (Draft). */
    createTimesheet: function (mBody) {
      return _postJson(_sService("timesheet") + "Timesheets", mBody);
    },

    createTimesheetItem: function (mBody) {
      return _postJson(_sService("timesheet") + "TimesheetItems", mBody);
    },

    updateTimesheetItem: function (sId, mBody) {
      return _patchJson(_sService("timesheet") + "TimesheetItems(" + sId + ")", mBody);
    },

    removeTimesheetItem: function (sId) {
      return _deleteJson(_sService("timesheet") + "TimesheetItems(" + sId + ")");
    },

    /** Real bound lifecycle action (Submit/StartReview/Approve/
     *  Reject/Withdraw/Cancel/Reopen). The backend self-approval
     *  and role scopes stay authoritative. */
    timesheetAction: function (sId, sAction, mParams) {
      return _postAction("timesheet", "Timesheets", sId, sAction, mParams);
    },

    readTimesheetHistories: function (sTimesheetId) {
      return _readList("timesheet", "TimesheetHistories", {
        select: "action,performedOn,comments,performedBy_ID",
        orderby: "performedOn desc",
        filter: "timesheet_ID eq " + sTimesheetId
      });
    },

    // ----------------------------------------------------------
    // Shifts & roster (service /odata/v4/attendance)
    // ----------------------------------------------------------
    readShifts: function () {
      return _readList("attendance", "Shifts", {
        select: "shiftCode,name,startTime,endTime,graceInMinutes,graceOutMinutes,breakMinutes,nightShift,status",
        orderby: "shiftCode"
      });
    },

    readShiftAssignments: function () {
      return _readList("attendance", "ShiftAssignments", {
        select: "effectiveFrom,effectiveTo,employee_ID,shift_ID",
        orderby: "effectiveFrom desc",
        expand: "shift($select=shiftCode,name)"
      });
    },

    readWorkSchedules: function (sDateFilter) {
      return _readList("attendance", "WorkSchedules", {
        select: "scheduleDate,remarks,employee_ID,shift_ID",
        orderby: "scheduleDate desc",
        filter: sDateFilter,
        expand: "shift($select=shiftCode,name)"
      });
    },

    readHolidays: function () {
      return _readList("attendance", "Holidays", {
        select: "holidayName,date,description,holidayCalendar_ID",
        orderby: "date"
      });
    },

    // ----------------------------------------------------------
    // Geo-attendance (service /odata/v4/geo) - READ ONLY: evidence
    // rows and fences are written exclusively by the backend.
    // ----------------------------------------------------------
    readGeofences: function () {
      return _readList("geo", "Geofences", {
        select: "geofenceCode,name,radiusMeters,status,effectiveFrom,effectiveTo",
        orderby: "geofenceCode"
      });
    },

    readLocationEvents: function (mOpts) {
      return _readList("geo", "AttendanceLocationEvents", {
        top: mOpts.top, skip: mOpts.skip,
        select: "eventType,result,latitude,longitude,distanceMeters,reason,eventTimestamp,employee_ID",
        orderby: "eventTimestamp desc",
        filter: mOpts.filter
      });
    },

    readEmployeesCount: function () {
      return _xhrJson(_sEmployeesQuery({ "$top": "0", "$count": "true" }))
        .then(function (oResult) { return oResult["@odata.count"] ?? (oResult.value || []).length; });
    },

    statusLabel: function (vValue) {
      return STATUS_LABELS[vValue] || (vValue || "—");
    },

    fmtDate: function (sIso) {
      if (!sIso) { return "—"; }
      return String(sIso).slice(0, 10);
    },

    /** Time display: "09:30:00" -> "09:30" (no invented values). */
    fmtTime: function (sTime) {
      if (!sTime) { return "—"; }
      return String(sTime).slice(0, 5);
    }
  };
});
