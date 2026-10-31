sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "ewms/EWMS/model/Backend"
], function (Controller, JSONModel, MessageToast, Backend) {
  "use strict";

  // Sprint 28 - Leave detail. Approval = PATCH of the REAL stage row
  // (LeaveApprovals.decision). The backend decides who may record a
  // decision (approver_ID = $user or HR) - a 403 here is displayed
  // honestly, never swallowed.

  return Controller.extend("ewms.EWMS.controller.LeaveDetail", {

    onInit: function () {
      this.oModel = new JSONModel({
        leaveNumber: "", statusText: "", typeText: "", fromDate: "",
        toDate: "", totalDays: "", halfDayText: "", paidText: "",
        appliedOn: "", reason: "", remarksText: "",
        approvals: [], histories: [], historyEmptyText: "",
        approvalError: "", approvalBusy: false, rejectError: "",
        busy: false, error: false, errorText: ""
      });
      this.getView().setModel(this.oModel, "lvD");

      this.getOwnerComponent().getRouter().getRoute("leaveDetail")
        .attachPatternMatched(this._onMatched, this);
      sap.ui.getCore().getEventBus().subscribe("ewms", "sessionChanged",
        this._onSessionChanged, this);
    },

    _onSessionChanged: function () {
      if (this._sId && Backend.getSession()) { this._load(this._sId); }
    },

    _onMatched: function (oEvent) {
      this._sId = oEvent.getParameter("arguments").id;
      if (!Backend.getSession()) {
        this.oModel.setProperty("/error", true);
        this.oModel.setProperty("/errorText",
          "Not signed in — choose a local dev identity in the side panel.");
        return;
      }
      this._load(this._sId);
    },

    _load: function (sId) {
      const oModel = this.oModel;
      oModel.setProperty("/busy", true);
      oModel.setProperty("/error", false);
      oModel.setProperty("/errorText", "");
      oModel.setProperty("/approvalError", "");

      // Real expands: leaveType + approvals are SAME-SERVICE (leave),
      // so $expand works. Approvers (Employee) live in another service
      // and are joined client-side below (restriction-aware).
      Backend.readLeaveRequestDetail(sId)
        .catch(function (oErr) { return { error: oErr }; })
        .then(function (oReq) {
          if (oReq.error) {
            oModel.setProperty("/error", true);
            oModel.setProperty("/errorText", oReq.error.message);
            oModel.setProperty("/busy", false);
            return;
          }
          oModel.setProperty("/leaveNumber", oReq.leaveNumber || "—");
          oModel.setProperty("/statusText", Backend.label(oReq.status));
          oModel.setProperty("/typeText", oReq.leaveType
            ? `${oReq.leaveType.leaveCode} ${oReq.leaveType.name}` : "—");
          oModel.setProperty("/fromDate", Backend.fmtDate(oReq.fromDate));
          oModel.setProperty("/toDate", Backend.fmtDate(oReq.toDate));
          oModel.setProperty("/totalDays",
            oReq.totalDays == null ? "—" : String(oReq.totalDays));
          oModel.setProperty("/halfDayText", oReq.halfDay
            ? `${Backend.label(oReq.halfDayType)}` : "No");
          oModel.setProperty("/paidText", oReq.leaveType && oReq.leaveType.isPaid
            ? "Yes" : "No");
          oModel.setProperty("/appliedOn",
            oReq.appliedOn ? Backend.fmtDate(oReq.appliedOn) : "—");
          oModel.setProperty("/reason", oReq.reason || "—");
          oModel.setProperty("/remarksText", oReq.remarks || "—");

          const asApproverIds = (oReq.approvals || [])
            .map(a => a.approver_ID).filter(Boolean);
          return Backend.readEmployeeMap(asApproverIds)
            .then(function (mEmp) {
              oModel.setProperty("/approvals", (oReq.approvals || []).map(a => ({
                ID: a.ID,
                level: a.level == null ? "—" : a.level,
                approverText: mEmp[a.approver_ID] || "—",
                decisionText: Backend.label(a.decision),
                decisionDate: a.decisionDate
                  ? Backend.fmtDate(a.decisionDate) + " " + Backend.fmtTime(a.decisionDate)
                  : "—",
                pending: a.decision === "Pending"
              })));
              return Backend.readApprovalHistories(sId)
                .catch(function (oErr) { return { error: oErr }; })
                .then(function (oHist) {
                  if (oHist.error) {
                    // Honest restricted state, e.g. plain-employee 403.
                    oModel.setProperty("/histories", []);
                    oModel.setProperty("/historyEmptyText",
                      "Audit history unavailable for your role: " + oHist.error.message);
                    return;
                  }
                  const asPerfIds = (oHist.rows || [])
                    .map(h => h.performedBy_ID).filter(Boolean);
                  return Backend.readEmployeeMap(asPerfIds)
                    .then(function (mPerf) {
                      oModel.setProperty("/histories", (oHist.rows || []).map(h => ({
                        action: h.action || "—",
                        performedOn: h.performedOn
                          ? Backend.fmtDate(h.performedOn) + " " + Backend.fmtTime(h.performedOn)
                          : "—",
                        performedByText: mPerf[h.performedBy_ID] || "—",
                        remarks: h.remarks || "—"
                      })));
                      oModel.setProperty("/historyEmptyText",
                        (oHist.rows || []).length ? "" : "No history rows yet");
                    });
                });
            });
        })
        .finally(() => oModel.setProperty("/busy", false));
    },

    // ---- Approval actions ------------------------------------------------

    onApprovePress: function (oEvent) {
      const sStageId = oEvent.getSource().getBindingContext("lvD").getObject().ID;
      this._patchDecision(sStageId, { decision: "Approved" }, "Leave approved at this stage.");
    },

    onRejectPress: function (oEvent) {
      this._sRejectStageId = oEvent.getSource().getBindingContext("lvD").getObject().ID;
      this.oModel.setProperty("/rejectError", "");
      this.byId("lvRejectDialog").open();
    },

    onConfirmReject: function () {
      const sRemarks = this.byId("lvRejectRemarks").getValue() || "";
      if (!sRemarks.trim()) {
        this.oModel.setProperty("/rejectError",
          "Remarks are required for a rejection (backend policy).");
        return;
      }
      this.byId("lvRejectDialog").close();
      this._patchDecision(this._sRejectStageId,
        { decision: "Rejected", remarks: sRemarks }, "Leave rejected.");
    },

    onCloseReject: function () { this.byId("lvRejectDialog").close(); },

    _patchDecision: function (sStageId, mPatch, sSuccessText) {
      if (this.oModel.getProperty("/approvalBusy")) { return; } // one click, one decision
      this.oModel.setProperty("/approvalError", "");
      this.oModel.setProperty("/approvalBusy", true);
      // REAL decision PATCH. Backend errors (not the approver, already
      // decided, missing remarks) are shown as-is in the stages panel.
      Backend.updateLeaveApproval(sStageId, mPatch)
        .then(() => {
          MessageToast.show(sSuccessText);
          return this._load(this._sId);
        })
        .catch((oErr) => this.oModel.setProperty("/approvalError", oErr.message))
        .finally(() => this.oModel.setProperty("/approvalBusy", false));
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("leave");
    }
  });
});
