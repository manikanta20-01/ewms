# Sprint 20 — HR Support / Helpdesk

Backend-only module: employee support requests with an agent-worked
lifecycle, kind-privacy comments, an append-only assignment/status
history, configurable per-category SLA targets and a computed overdue
view. Built on the existing Employee / Document / DepartmentHR models —
no new master data, no duplicated document storage, no new
security/audit/notification framework.

Sprint 19 gate passed first (fresh evidence recorded in SPRINT-19.md §6a:
targeted 28/28, full suite 272/272, both compiles exit 0).

---

## 1. Pre-conditions (Sprint 19 completion gate)

- Sprint 19 targeted suite: **28/28 pass, 0 fail, exit 0** (`test/policy.test.js`).
- Full `npm test` regression at the gate (pre-Sprint 20): **272/272 pass, 0 fail, 0 cancelled/skipped, exit 0** (~37 s, natural termination).
- `npx cds compile srv --to csn` and `npx cds compile db --to hana`: both **exit 0**, no warnings.
- SPRINT-19.md status: **COMPLETE**, with the fresh A2 requirement-classification table added.

## 2. Design decisions and why

1. **One action perimeter.** The lifecycle moves ONLY through bound
   actions (`Assign`, `Start`, `WaitForEmployee`, `Resolve`, `Close`,
   `Reopen`, `ChangePriority`, `AddComment`). `HRTickets` has a CREATE
   grant but **no UPDATE/DELETE grant for anyone**, so a direct PATCH can
   never smuggle a status/assignee change and nothing is ever deleted.
2. **Requester scoping IS the isolation.** A support ticket is a
   person-level object: read access is `requester_ID = $user.employeeId`
   for the non-HR roles (grant-level where-clause — the perimeter itself,
   not a UI hide) and full access for the HR trio (the support agents).
   A company/legal-entity column would be weaker than this; none is
   invented (documented decision).
3. **Comments are the evidence trail.** Three kinds:
   `InternalNote` (agents only, filtered from every requester read),
   `AgentResponse` (official reply; first one stamps `firstResponseAt`
   as the actual-response-time measurement input), `EmployeeResponse`
   (requester only, own ticket only). Direct comment CREATE is refused
   (no grant → 403) and records are immutable (no UPDATE/DELETE).
4. **Waiting is a conversation state.** `WaitForEmployee` + an
   `EmployeeResponse` comment automatically returns the ticket to
   `InProgress` (documented rule) and notifies the assignee or the
   department's registered HR representatives (`DepartmentHR`, Sprint 2
   configuration). With no assignee and no configured representative,
   nobody is notified — nothing is invented.
5. **SLA is configuration, never code.** `HRTicketCategorySLA` rows
   (one per category, nullable response/resolution target hours) are
   HR-maintained. No hardcoded SLA value exists anywhere; a category
   without a target can never be overdue on that axis. `OverdueTickets`
   is COMPUTED at read time from those targets — never stale — and the
   `hoursOverdue` column is escalation *readiness* for a future
   background job, not an automatic loop (the repo has no scheduler).
6. **Reuse instead of rebuild.** Notifications ride the shared
   `notify()` core (new `SUPPORT` category; messages deliberately do NOT
   contain ticket description text). Lifecycle changes are audited via
   the shared `persistAudit` helper + generic audit hooks; generated
   codes reuse `generateCode`; idempotent retries reuse the
   `clientRequestId` pattern from Sprint 19. The Sprint 17 document
   store is referenced by `attachedDocument_ID` (validated: the actor
   may only attach documents they own, HR any) rather than duplicated.
7. **Duplicate-safe creation.** Same requester + same `clientRequestId`
   → 409 pointing at the FIRST ticket (`TCKxxxx`) — a retry can never
   create a second one. Retried actions are idempotent: re-Assign to the
   same agent and ChangePriority to the same priority return a friendly
   no-change message WITHOUT a duplicate event or notification.

## 3. Data model (`db/helpdesk/helpdesk.cds`)

| Entity | Purpose |
|---|---|
| `HRTicket` | `ticketCode` (server-generated TCK0001-style), requester (always server-stamped), requesterDepartment (informational), category/subcategory-vocabulary, subject, description, priority, status, assignee + assignedOn, `firstResponseAt`/`resolvedOn`/`closedOn` (SLA measurement timestamps), `resolutionNotes`, optional `attachedDocument_ID` (no association on purpose — the Document surface stays only with the Sprint 17 employee service; an auto-exposed helpdesk Document projection would have leaked employee documents), `clientRequestId` (safe retries). |
| `HRTicketComment` | ticket, author (server-set), kind, text. Immutable. |
| `HRTicketEvent` | append-only history: Created / Assigned / Reassigned / StatusChange / PriorityChanged / Reopened, with actor, reason, from/to status, from/to assignee. |
| `HRTicketCategorySLA` | configurable response/resolution target hours per category (nullable = no target), `active` flag. |

New vocabulary: `HRTicketCategory` (PayrollQuery, LeaveQuestion,
EmployeeRecords, Benefits, PolicyClarification, GeneralHR),
`HRTicketPriority` (Low, Medium, High, Urgent), `HRTicketStatus` (New,
Assigned, InProgress, WaitingForEmployee, Resolved, Closed),
`HRTicketCommentKind` (InternalNote, AgentResponse, EmployeeResponse).
Lifecycle, chosen and documented:

```
New -> Assigned -> InProgress -> WaitingForEmployee
             \---------\-------------> Resolved -> Closed
WaitingForEmployee --(EmployeeResponse)--> InProgress
Resolved/Closed --(Reopen, reason)--> InProgress (assignee kept) / New
Not every ticket must visit every state (e.g. assign+resolve is legal).
```

## 4. Service & security (`srv/helpdesk/`)

`HelpdeskService` (`@requires: authenticated-user`); grants are the
perimeter, handlers re-check ownership, state and privacy server-side.

- `HRTickets` — READ: own rows for Employee/manager classes
  (`where: requester_ID = $user.employeeId`), all for the HR trio;
  CREATE: requester roles (requester is server-stamped, spoofed payload
  ignored; users without a resolvable employee record — e.g.
  SystemAdmin — MUST nominate one); NO UPDATE/DELETE for anyone.
  Actions: `Assign`/`Start`/`WaitForEmployee`/`Resolve`/
  `ChangePriority` are agent-only with handler re-checks (Start is
  rejected for an HR actor who is not the assignee; changes are refused
  in invalid states); `Close`/`Reopen` are requester-or-HR with
  ownership re-checked; `AddComment` is open to all parties with the
  kind + ownership rules above.
- `HRTicketComments` — READ for employee classes (in-place after-READ
  filter: own tickets' comments minus `InternalNote`) and HR (all).
  No write grants; records only via `AddComment`, immutable.
- `HRTicketEvents` — HR-only (internal routing details stay out of
  requester reads). Never edited or deleted.
- `HRTicketSLAConfigs` — HR trio CRUD.
- `OverdueTickets` — computed at read; HR-only (same line-of-sight as
  Sprints 17/19: managers get no cross-employee support data);
  honors simple `ticket_ID` / `category` filters.
- Notifications: SUPPORT category via shared `notify()` — creation →
  department's active DeptHR reps; assignment/reassignment → assignee +
  requester; waiting → requester; requester reply → assignee (or DeptHR
  when unassigned); agent reply → requester; resolve → requester; close
  → assignee; reopen → assignee. Idempotent actions add NO notifications.
- Audit: generic hooks (all four entities) + explicit `persistAudit`
  rows for Assign/Reassign/StartProgress/WaitForEmployee/Resolve/
  Close/Reopen/ChangePriority.

## 5. Automated tests (`test/helpdesk.test.js`)

9 suites / 22 tests (targeted run:
`CDS_ENV=log-bin CDS_ENV=test node --test test/helpdesk.test.js` → 22/22, exit 0):

1. creation & validation — server-stamped requester (spoofed
   `requester_ID` ignored), generated `ticketCode`, field checks,
   `clientRequestId` retry → 409 with exactly one row, admin-assisted
   nomination (mandatory for users without a resolvable employee);
2. anti-bypass — direct PATCH/DELETE on tickets refused (403) and state
   unchanged, direct comment POST 403, comment PATCH/DELETE 403;
3. lifecycle & invalid transitions — full happy path incl. the
   automatic Waiting→InProgress, resolution-notes requirement, wrong
   state/wrong actor refusals (Start by non-assignee HR → 403), no
   assignment of resolved tickets;
4. assignment history & idempotency — Assigned/Reassigned events with
   from/to assignees, same-agent retry no-op, events HR-only (403);
5. comments & privacy — kind rules (employee cannot write agent kinds,
   unknown kind refused), `firstResponseAt` stamped on first agent
   response, InternalNote filtered from requester reads AND other
   tickets' comments invisible, HR sees all, Waiting+EmployeeResponse
   auto-returns to InProgress and notifies the assignee;
6. requester privacy — JOHN sees own list only, others' by-ID → 404,
   no action grants, HR sees all;
7. reopen — reason required, requester/HR only, status + history
   preserved (events show Resolved→InProgress with reason), then full
   second close;
8. SLA & overdue — HR-maintained config (employee write 403), computed
   overdue row (response type, hours math), overdue disappears once the
   agent answers / the ticket resolves, no-config categories can never
   be overdue, requester denied;
9. notifications & audit + regression smoke — SUPPORT category
   notifications for creation/assignment, idempotent retry adds none,
   audited Assign/Resolve rows visible to SystemAdmin; Sprints 17/18/19
   endpoints still serve.

Implementation evidence trail (bugs found and fixed by these tests):
the notification-privacy test exposed that the comment after-READ
filter's returned array was ignored by CAP (after-READ only applies
in-place modifications — now spliced in place), and that notifications
are strictly recipient-readable (the test helper now reads as the
recipient). Both are behavior fixes, not test-weakening.

## 6. Final verification evidence

| Check | Result |
|---|---|
| `test/helpdesk.test.js` targeted | **22/22 pass, 0 fail, exit 0** |
| Full `npm test` (CDS_ENV=test) | **294 tests / 94 suites: 294 pass, 0 fail, 0 cancelled, 0 skipped, exit 0** (~48 s; processes exit naturally) |
| `npx cds compile srv --to csn` | exit 0, 0 warnings |
| `npx cds compile db --to hana` | exit 0, 0 warnings |
| Sprint 19 / earlier regression | inside the full run; no regressions (28 policy + 24 engagement tests still pass within 294) |

Temporary probe files used during development (`test/probe20*.js/.test.js`)
were deleted before the final run — the full suite terminated naturally
on its own (evidence above). No test was skipped or weakened.

## 7. Files changed / added

Added:

- `db/helpdesk/helpdesk.cds` — HRTicket / HRTicketComment /
  HRTicketEvent / HRTicketCategorySLA model,
- `srv/helpdesk/helpdesk-service.cds` — service, bound actions,
  computed OverdueTickets,
- `srv/helpdesk/helpdesk-security.cds` — grant perimeter,
- `srv/helpdesk/helpdesk-service.js` — service binding + audit hooks,
- `srv/helpdesk/handlers/helpdesk-common.js` — shared helpers (roles,
  event writer inputs, DepartmentHR routing),
- `srv/helpdesk/handlers/ticket-lifecycle.js` — creation guards +
  lifecycle actions + events + audit + notifications,
- `srv/helpdesk/handlers/ticket-comments.js` — AddComment + privacy
  filter + auto-transition,
- `srv/helpdesk/handlers/ticket-reporting.js` — computed OverdueTickets,
- `test/helpdesk.test.js` — 22-test targeted suite,
- `docs/sprints/SPRINT-20.md` — this report.

Changed:

- `db/schema.cds` — include the helpdesk namespace,
- `db/common/enums.cds` — Sprint 20 enums + `SUPPORT` notification
  category (also restored the Sprint 19 comment block whose first line
  was clipped by an earlier edit),
- `srv/services.cds` — serve HelpdeskService + security,
- `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md` — Sprint 20 section + TOC +
  implemented-modules note + roadmap moved to Sprint 21,
- `SETUP.md` — Sprint 20 test file listed,
- `docs/sprints/SPRINT-19.md` — fresh gate evidence + classification.

## 8. Remaining policy decisions / limitations (documented, not blocking)

1. **No automatic escalation** — `OverdueTickets.hoursOverdue` is
   escalation readiness; a future background job would call it (same
   gap as Sprint 17/19 reminders). Nothing is claimed to be scheduled.
2. **SLA hours are wall-clock** — no business-hours calendars; targets
   are configured by HR and remain nullable/off by default.
3. **Category list is a fixed neutral enum** (no company-specific
   category configurator); subcategories intentionally not modeled.
4. **Agent = HR role**, not a separate "SupportAgent" role — reuses the
   Sprint 9 role model per existing conventions.
5. **Requester-visible ticket history** = the ticket fields they can
   read; the internal `HRTicketEvents` trail (routing detail) is HR-only.
6. SQLite/HANA: plain tabular data + managed aspects; HANA runtime
   profile remains untested (standing limitation across all sprints).

## 9. Final status: **COMPLETE**

No unresolved critical authorization or data-integrity defects: all
lifecycle moves are action-gated and state-validated, direct writes have
no grants, requester privacy is grant-level + handler-filtered,
internal notes never leave the HR perimeter, duplicates are impossible
for creation and idempotent for no-op actions, and every transition is
audited. Production readiness is NOT claimed from local tests (HANA/
BTP auth/deployment unexercised; standing limitations documented).
