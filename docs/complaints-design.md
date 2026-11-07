# Complaints: service, lifecycle and routes (T13a)

Server side only: no provider adapter, no network. The resident screens (T13b) are in `docs/complaints-ui.md`; staff screens are not built. The classification rules are in `docs/complaint-classification.md` (T10a); this document is what
happens around them. Decisions: D9, D15, D39, D73, D118, D119, D120, D121 (`docs/decisions.md`). Code: `src/domain/complaints/lifecycle.ts`, `body.ts`,
`timeline.ts`; `src/server/complaints/*`; routes under `src/app/api/complaints` and `src/app/api/staff`.

## The flow

1. **Raise** (`createComplaint`, resident with a current flat). The text is 1 to 2,000 characters after trimming; control characters are removed and the words
   are kept as written (`prepareComplaintBody`). `language` holds the script label LATIN, DEVANAGARI or MIXED. A repeat of the same text by the same person
   within 60 seconds returns the first complaint (checked again under an advisory lock, so six simultaneous taps make one).
1a. **Declared danger** (T13b, D121): `POST /api/complaints` takes an optional boolean `declaredDanger` (default false). True takes the safety path exactly as a
   safety word does (CRITICAL, no classifier call, the duty manager, ESCALATED with reason `DECLARED`, a SAFETY_ALERT notification), whatever the text says;
   `CREATED` records `{ declaredDanger: true }`. An empty text is accepted only with it, stored as "(no description)" with the note `NO_DESCRIPTION`.
2. **Classify** (`classifyComplaint`), outside the transaction so a slow classifier never holds a database connection:
   - the safety rules read the RAW text first; a hit never calls the classifier (D119);
   - otherwise the DE-IDENTIFIED text (T10a `deidentify`: no phone, e-mail, flat code or known name) goes to the classifier port within a hard total budget of
     4,000 ms (D118); then `decideClassification` (T10a) decides.
3. **Write**, in ONE transaction: the complaint, one `classifications` row (source RULE, LLM, FALLBACK or MANUAL, confidence, latency, SHA-256 of the canonical
   JSON of the decision), the events, and for a safety complaint the notification. `response_due_at` is the creation time plus the `sla_minutes` setting.
4. **Work**: staff assign, move to IN_PROGRESS, mark resolved, comment, correct the category; every change takes the row lock, needs the `expectedVersion`
   (409 STALE otherwise), is decided by the lifecycle below, and appends its events and one audit row.
5. **Close**: the resident confirms (optional rating) or reopens (reason of 5 to 500 characters); with no answer for `auto_close_days` the complaint closes by
   itself (D15, D120). A safety complaint is closed only by the duty manager.

## The lifecycle (`applyTransition`, pure)

| From | Allowed to | Rule |
|---|---|---|
| NEW | ASSIGNED, IN_PROGRESS, PENDING_CONFIRMATION | |
| ASSIGNED | IN_PROGRESS, PENDING_CONFIRMATION | |
| IN_PROGRESS | PENDING_CONFIRMATION | |
| PENDING_CONFIRMATION | CLOSED, REOPENED | CLOSED by the resident's confirm (CONFIRMED) or after `auto_close_days` (AUTO_CLOSED) |
| CLOSED | REOPENED | within 7 days of `closed_at`; also a DUTY_MANAGER closure of a safety complaint (the resident may dispute it) |
| REOPENED | ASSIGNED, IN_PROGRESS, PENDING_CONFIRMATION | |

Actions: ASSIGN (NEW and REOPENED become ASSIGNED; ASSIGNED and IN_PROGRESS keep their status), START, MARK_RESOLVED (never for a safety complaint), RESPOND
(a comment or an acknowledgement: only `first_response_at`), CONFIRM, REOPEN, AUTO_CLOSE (never for a safety complaint), CLOSE_SAFETY (only for a safety
complaint, DUTY_MANAGER). `first_response_at` is set by the first staff action if still empty and never changes. A reopen clears `closed_at`, `close_kind`,
`pending_confirmation_at` and `rating` and adds one to `reopen_count`.

The result always satisfies the database checks: K1 (a safety complaint is CRITICAL), K2 (a safety complaint is never AUTO_CLOSED or CONFIRMED), K3 (CLOSED has
`closed_at` and `close_kind`; nothing else has them; PENDING_CONFIRMATION has its time), K4 (a rating only on a CONFIRMED close, 1 to 5; a REOPENED complaint has
`reopen_count` of at least 1). `tests/domain/complaints/lifecycle.test.ts` writes them as predicates and walks 2,000 seeded random action sequences;
`tests/integration/complaints-e2e.test.ts` writes 60 such sequences to a real database.

## SLA

`response_due_at = created_at + sla_minutes[urgency]`, from the society setting (default CRITICAL 15, HIGH 120, NORMAL 1,440, LOW 4,320 minutes). The SLA state of a
row is ON_TIME (not answered, not yet due), MET, OVERDUE (not answered and past the due time, or marked resolved after the due time) or NONE (closed).

## The safety path

A safety hit: `safety_flag`, urgency CRITICAL, category from the keyword fallback or none, no model call, assigned at once to the duty manager (the active staff
user with `complaints:duty_manager`; with several, the smallest name; with none the complaint stays NEW and the ESCALATED event says `NO_DUTY_MANAGER`),
events CREATED, CLASSIFIED (source RULE), ESCALATED, ASSIGNED, and a `SAFETY_ALERT` notification whose body is the complaint id and a fixed sentence (no text, no
name, no flat). The duty manager acknowledges (`first_response_at`, an event of type COMMENT with payload `kind: "ack"`) and closes with a note
(`close_kind` DUTY_MANAGER). Neither needs `complaints:manage`; both need `complaints:duty_manager`.

## The port

`Classifier` (`src/server/complaints/classifier.ts`) is the domain's `ClassifierPort` plus an optional `AbortSignal`. `NullClassifier` always answers nothing and
is what production uses when no provider is configured; with one, `JevClassifier` asks the System One providers (D140, `docs/classifier-providers.md`). The tests use a configurable fake (`tests/integration/complaints-helpers.ts`). A classifier that throws,
times out or answers nothing is "no arm": the keyword fallback answers. A present answer goes where `decideClassification` sends it: an invalid answer (including
one that says CRITICAL) takes the keyword fallback; a valid answer that disagrees or is low in confidence goes to a person (`needs_review`, no assignee, NEW).

## The board and the reads

Lanes (a complaint can be in several; the counts are per lane): NEEDS_TRIAGE (not closed, and `needs_review` or no assignee), OPEN (ASSIGNED, IN_PROGRESS or
REOPENED), OVERDUE, WAITING_RESIDENT, SAFETY (not closed), CLOSED. Newest first, keyset pagination on (creation time, id) with an opaque cursor. A resident
sees the timeline built by `residentTimeline`: Raised, Assigned, status changes, comments marked visible, "Sent to the duty manager", Reopened, Closed.
CLASSIFIED, corrections, links, acknowledgements, internal notes and every name are never shown. A complaint of another flat is 404, like a missing one.

## Routes

Resident (`RESIDENT`): `POST` and `GET /api/complaints`, `GET /api/complaints/[id]`, `POST .../confirm`, `POST .../reopen`. Staff (`complaints:manage`):
`GET /api/staff/complaints?lane=&cursor=&limit=`, `GET /api/staff/complaints/[id]`, `POST .../assign`, `.../status`, `.../comment`, `.../category`, `GET
/api/staff/users`. Duty manager (`complaints:duty_manager`): `POST .../acknowledge`, `.../close`. Status: 200 and 201 ok; 409 STALE and INVALID_TRANSITION; 422
NO_FLAT, VALIDATION and ASSIGNEE_INVALID; 404 NOT_FOUND; 403 permission. The body of a refusal is only `{ "error": CODE }`. The app role gets column-level UPDATE on
thirteen columns of `complaints` and nothing else (D95).

## What is absent

Translation, duplicate linking, reminders and escalation timers, a notifications list, the staff screens. The resident screens are
built (`docs/complaints-ui.md`). Auto-close has no cron: the two list routes, the resident's list and detail pages and the Home call `autoCloseDue` as they load
(D120); the staff screens will call it when they are built.

## Assumptions

- **A1** Re-assigning an ASSIGNED or IN_PROGRESS complaint keeps its status; only NEW and REOPENED become ASSIGNED.
- **A2** The reopen window is 7 days, a constant (`defaultLifecycleSettings.reopenWindowDays`), not a society setting. The boundary is inclusive.
- **A3** The complaints clock is the business clock (D97), as on the Home. Under a frozen demo clock the same text by the same person is a repeat for as long as the clock stays frozen.
- **A4** OVERDUE "resolved past SLA" means `pending_confirmation_at` later than `response_due_at`. OPEN includes REOPENED. Newest first (by creation time) in every lane.
- **A5** When nothing could classify a complaint (source NONE) the `classifications` row says FALLBACK with no category: the fallback was the last thing tried.
- **A6** `needs_review` is true whenever the category is unknown, a safety complaint included.
- **A7** A staff comment is shown to the resident only when marked `visibleToResident: true`. A comment with no mark (the seeded ones) is hidden.
- **A8** A comment, and an acknowledgement, set `first_response_at` but do not change `version`, so they never make another person's pending change stale. A safety closure needs a note of 5 to 500 characters.
- **A9** Events of one complaint are strictly increasing in time (each at least 1 ms after the one before), so the timeline never depends on a tie.
- **A10** A default assignee that is inactive, or lacks `complaints:manage`, counts as no assignee. A category correction does not assign; correcting to the category the complaint already has is VALIDATION.
- **A11** The timeline labels are English strings in the data, with a `kind`; the UI translates by `kind` later.
- **A12** The classifier is asked as one arm, `DIRECT`, with `allowSingleArm` true; the benchmark's two-arm gate is not used here.
- **A13** `autoCloseDue` works in chunks of 100 and goes on until none is due.
