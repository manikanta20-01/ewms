# Sprint 18 — Employee Engagement (Completion Report)

Status: **COMPLETE** (backend-only; new `engagement` module built on the existing
Employee model — no duplicate entities, no duplicated security/notification/
audit infrastructure).

## 1. Pre-conditions (Sprint 17 completion gate)

Re-verified immediately before this sprint, from the live repository:

- Sprint 17 targeted suite `test/compliance.test.js`: **23/23 pass, exit 0**.
- Full `npm test` regression: **220/220 pass, 0 fail, exit 0**.
- `npx cds compile srv --to csn` → exit 0; `npx cds compile db --to hana` → exit 0.
- [SPRINT-17.md](./SPRINT-17.md) annotated with the re-verification evidence.

Inspection found NO pre-existing survey/feedback/suggestion/recognition/
announcement code (`grep -rli` across `db/`, `srv/`, the system guide) — the
engagement module is therefore NEW, not an extension of duplicate machinery.

## 2. Chosen scope and why

Three capabilities were implemented, each fitting the existing architecture:

1. **EngagementSurveys** (questionnaires with lifecycle + confidentiality):
   the most specification-heavy part of B2/B3 — surveys need real lifecycle
   control (Draft → Published → Closed → Archived), date-window enforcement,
   per-question response types and aggregate-only results, none of which an
   existing module provides.
2. **Suggestions** (employee feedback with review lifecycle): B4 —
   lightweight, no workflow engine required (a simple forward-only ledger
   fits; the generic approval engine is deliberately NOT reused because a
   suggestion does not need multi-step approvers).
3. **Recognitions** (employee-to-employee "kudos"): B5 — server-validated
   sender, self-kudos refusal, safe duplicate handling, HR moderation.

**Not implemented, deliberately** (avoiding unnecessary complexity, per B2):

- Engagement *activities* with participation records — no existing audience/
  calendar infrastructure supports it well; would duplicate notification
  targets and add a module with no testable policy.
- Anonymous feedback — see the privacy decision in §4.
- Target-audience configuration beyond employment type + publishers
  (department/team audience building is deferred; the current rule mirrors
  Sprint 17's requirement applicability and is fully server-validated).

## 3. Data model (`db/engagement/engagement.cds`)

- `EngagementSurvey` — status, openingDate/closingDate, `confidential`,
  `allowMultipleResponses`, optional `audienceEmploymentType`.
- `SurveyQuestion` — questionText, responseType (Text/Rating/YesNo/Choice),
  isRequired, sortOrder, newline-separated `choiceOptions` for Choice.
- `SurveyResponse` (+ `SurveyAnswer` values in typed columns) — Submitted /
  Withdrawn; answers have `@cds.autoexposed: false` so no OData collection
  exists (direct GET `/SurveyAnswer` → 405, even for admins).
- `Suggestion` — submittedBy (server-set), category, subject, message,
  status InReview/Accepted/Rejected/Closed with reviewer + outcome fields.
- `Recognition` — fromEmployee (server-set), toEmployee, category, message,
  recognitionDate, moderation fields.

## 4. Security & privacy design

- Role grants live in `srv/engagement/engagement-security.cds`, following the
  existing `*-security.cds` pattern:
  - survey authoring, lifecycle actions (`Publish/Close/Archive`) and
    `SurveyResults`: **HRAdmin + SystemAdmin only** (bound actions are
    restricted through the entity `actions { ... }` annotate block);
  - survey metadata readable by everyone WHO IS AUTHENTICATED, but **Draft
    and Archived surveys are hidden from non-HR readers** by a before-read
    rejection + in-place after-read row filter (grants cannot express the
    per-status rule; a custom ON read handler was deliberately avoided —
    see §6, CAP lesson);
  - `Submit`/`Withdraw` open to all roles; eligibility re-checked server-side;
  - `SurveyResponses` readable by the respondent (where-clause) + HR admin;
  - `Suggestions` self-scoped for employees; reviewer access for the HR trio
    (`Resolve` action); managers deliberately get NO feedback access;
  - `Recognitions` readable by everyone; sender identity server-set;
    moderation = HRAdmin/SystemAdmin.
- Identities are immutable from the payload: `submittedBy` / `fromEmployee`
  are ALWAYS overwritten in the before-CREATE handlers, so a spoofed
  `*_ID` is ignored (tested).
- **Not-anonymous is a documented decision:** suggestions keep the submitter
  association, and the shared audit framework records the actor of every
  administrative change — hiding the association while the audit trail still
  stored identity would be honored-in-the-breach anonymity. A confidential
  *survey* instead restricts individual answers structurally: answers are
  never addressable as an entity, and aggregate results never include text
  content (free-text answers are reported as the count marker
  `"(text answer)"` only). Privacy limitation is documented rather than
  over-claimed.
- Audit: `registerAuditHooks` covers surveys, questions, responses,
  suggestions and recognitions. SurveyAnswer values are deliberately
  EXCLUDED from audit to not copy confidential content into the log.
- Notifications reuse the single shared `notify()` core (publish invitations
  per target employee; reviewer decision → submitter; recognition →
  recipient). No notification framework was duplicated. Schedule-based
  reminders are NOT built — the repo has no scheduler (documented, not
  claimed).

## 5. Automated tests (`test/engagement.test.js`)

**24 tests, 24 pass, 0 fail, 0 skipped, exit 0**, covering:

- authoring security (draft invisibility in list AND single read, admin-only
  CRUD, payload-status immutability, question validation),
- lifecycle one-way transitions (publish needs questions; double publish 409;
  close/archive order; published rows cannot be deleted; direct PATCH
  refused everywhere),
- response window + server-side audience checks (opens-on / closed / wrong
  employment type all refused),
- duplicate-submission rule and the withdraw → re-submit correction route,
  including cross-employee withdraw denial,
- per-question answer validation (unknown question, required missing, rating
  1–5, choice options, one answer per question),
- aggregate-only results (withdrawn responses excluded; employees denied),
- confidentiality: text content never appears in results in any form;
  `/SurveyAnswer` is not routeable (405) even for admins; Draft surveys have
  no results,
- suggestion lifecycle (server-set identity, employee cannot decide, invalid
  transitions, post-review edit lock, cross-employee edit denial, decision
  notification to the submitter),
- recognitions (sender server-set, self-kudos refusal, exact-duplicate 409,
  future-date refusal, unknown recipient 404, recipient notification, HR-only
  moderation with stamped metadata, content immutability),
- notification dedupe/scoping (exactly one publish invitiation per targeted
  employee),
- audit rows for survey administrative actions.

## 6. CAP implementation lessons (kept for future sprints)

- **Custom `on("READ")` handlers on a persisted entity break the OData
  create response** (201 with empty body). The engagement module therefore
  uses before/after READ handlers exclusively.
- **After-READ handlers must filter rows IN PLACE** — CAP ignores their
  return value for list reads.
- **Bound-action `req.params[0]` may be a scalar key**, not `{ID}` — every
  binding read uses `req.params?.[0]?.ID ?? req.params?.[0]`.
- Composition targets are auto-exposed as entity sets in v4 metadata unless
  `@cds.autoexposed: false` is set (routeable access is refused with 405).
- Mocked-auth `req.user.roles` values are truthy but not strictly `true` —
  role checks MUST go through the shared `common/auth/authorization.hasRole`
  (raw `roles[x] === true` silently denies admins).

## 7. Final verification evidence

| Check | Result |
|---|---|
| Sprint 18 targeted suite | 24/24 pass, 0 fail, exit 0 |
| Sprint 17 targeted suite (regression) | 23/23 pass, exit 0 |
| Full `npm test` | **244/244 pass, 0 fail, 0 skipped/cancelled, exit 0** |
| `npx cds compile srv --to csn` | exit 0 |
| `npx cds compile db --to hana` | exit 0 |

All test processes terminated naturally (no `process.exit`, no timeouts hit).

Post-Sprint 19 confirmation (no engagement regression): the full suite
after Sprint 19 runs **272/272 pass, 0 fail, exit 0**
(see `docs/sprints/SPRINT-19.md` §6).

## 8. Files changed / added

Added:

- `db/engagement/engagement.cds` — the three engagement entities + answer
  storage (auto-exposure disabled for SurveyAnswer),
- `srv/engagement/engagement-service.cds` — service projections + bound
  lifecycle/submit/withdraw/results/resolve actions,
- `srv/engagement/engagement-security.cds` — grants for the shared roles,
- `srv/engagement/engagement-service.js` — audit hook registration,
- `srv/engagement/handlers/surveys.js` — authoring validation, draft
  visibility, lifecycle actions, submission/withdraw/result logic,
- `srv/engagement/handlers/feedback.js` — suggestions review lifecycle +
  recognitions moderation,
- `test/engagement.test.js` — 24-test targeted suite,
- `docs/sprints/SPRINT-18.md` — this report.

Changed:

- `db/schema.cds` — include the engagement entities,
- `srv/services.cds` — serve EngagementService + security,
- `db/common/enums.cds` — Sprint 18 vocabulary (SurveyStatus, response
  types, response status, suggestion lifecycle/categories, recognition
  categories),
- `docs/EWMS_COMPLETE_SYSTEM_GUIDE.md` — Sprint 18 section + TOC + planned
  list moved to Sprint 19+.

## 9. Remaining policy decisions / limitations (documented, not blocking)

1. **No anonymous feedback channel** — a future "true anonymity" design
   would require a separate storage path that bypasses the audit framework;
   needs an explicit HR/legal policy decision first.
2. **Survey audiences**: employment-type targeting only. Department/team/
   multi-entity audiences need audience-selection UX input from HR and are a
   documented extension (server hooks already validate `audienceEmploymentType`).
3. **Reminder campaigns** (re-inviting non-responders periodically) need the
   background scheduler gap closed (same as Sprint 17 reminders); the
   `notify()` core is retry-safe already.
4. **Retention** of engagement records is admin-managed (Archive status);
   no statutory retention period is invented (same policy as Sprint 17).
5. SQLite/HANA: the module uses plain tabular data + managed aspects only —
   schema-identical on both; HANA runtime profile remains untested (the
   standing limitation across all sprints).
