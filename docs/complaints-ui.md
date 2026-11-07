# Complaint screens (T13b)

The resident side of complaints: the list, the form with the danger question, one complaint with its confirm and reopen answers, and the safety alert on
the Home. The service, the lifecycle and the routes are in `docs/complaints-design.md` (T13a); the classification rules in
`docs/complaint-classification.md`. Decisions: D121 (declared danger), D126 (the safety alert slot and the outlined Pay), D127 (the form asks the danger
question and never preselects an answer), and D15, D39, D43, D54, D58, D120 (`docs/decisions.md`). Strings are all in `src/lib/messages/en.ts`.

## Pages

| Address | Files | What it shows |
|---|---|---|
| `/complaints` | `src/app/(resident)/complaints/` | One filled "Raise a complaint" control; open complaints first (title, status with a mark, the tracker, "Step n of 4", reply-due text), each a link to its page; closed ones in a collapsed "Closed (n)" section; "No open complaints"; loading and error states. |
| `/complaints/new` | `.../new/` | The form: the text (counter, 2,000 characters), the required question "Is anyone in danger right now?", Send. |
| `/complaints/[id]` | `.../[id]/` | Title, status tag, tracker, reply-due line, what the resident may do, and the timeline the resident may see (dates and labels from `residentTimeline`). |
| `/` (Home) | `src/app/(resident)/` | The Complaints section has the header link "Raise a complaint" and the card links to its page; the safety alert sits above the dues. |

Every page calls `requireUser({ need: "RESIDENT" })` (a staff member is sent to `/forbidden`); `tests/server/page-guards.test.ts` lists them. The loaders
(`src/server/complaints/page-data.ts`) take the flat from the person's memberships and never from the request. Bottom navigation has the Complaints tab
(chat icon); the Emergency sheet's "Raise a complaint" items and its "Not an emergency? Raise a complaint" button link to `/complaints/new`.

## The danger question, and why it exists

A resident who writes "the lift smells of burning" is caught by the safety words. A resident who writes "please come quickly, my father fell and the
door is locked" is not: there is no safety word in it, in any of three languages, and a keyword list will always have such holes. So the form asks. The
question comes after the text, has **Yes and No and no default**, and is required: a submit without an answer shows "Choose Yes or No." and sends
nothing (the rule is the pure `fieldErrorsOf` in `src/lib/complaint-form.ts`). A preselected "No" would make the answer a habit rather than a statement,
and a missing answer would make the server guess.

- **Yes** shows at once, in the form, "If someone is in danger, call the duty manager now." with a large `tel:` link (the `duty_manager_phone` setting) and
  "You can still send this report." The report may be sent with nothing written (D121): the server stores the fixed text "(no description)" and a note,
  and never invents content. While Yes is chosen the call link is the one filled control and Send is outlined.
- The server takes the safety path for `declaredDanger: true` exactly as for a safety word (D121): CRITICAL, no classifier call, the duty manager, an
  ESCALATED event with reason `DECLARED` (`SAFETY_RULE` when a word matched), a SAFETY_ALERT notification; K1 to K4 hold. The Home alert then says "Your
  report", because nothing says what it was about; it names a category (fire, gas, lift, electric shock) only when a safety word does.
- A declared danger is never merged into an earlier normal complaint with the same text inside the 60-second repeat window.

## The form's states

Empty (nothing chosen, no errors); refused (inline errors linked to their fields by `aria-describedby`); sending (loading label, fields disabled, a second
tap does nothing, also guarded by a ref); failed (a plain sentence and "Try again" for a 422 VALIDATION, a 429, the network and the server; 422 NO_FLAT
says to ask the society office and offers no retry that cannot work). Success goes to `/complaints/<id>?sent=1`, which shows a confirmation banner. All of
it is the pure reducer `complaintFormReducer` (`src/lib/complaint-form.ts`) with `classifyCreate` for the answer; the component only dispatches.

## One complaint: what the resident may do

| State | Shown |
|---|---|
| Open (NEW, ASSIGNED, IN_PROGRESS) | Tracker, "Step n of 4. Reply due ...", timeline. No buttons. |
| PENDING_CONFIRMATION, ordinary | "Is it fixed?" with "Yes, it's fixed" and "No, still a problem" of equal weight, and "It closes by itself after N days if you don't answer." (N is `auto_close_days`). Yes leads to an optional 1 to 5 rating, then Done. No leads to a required reason of 5 to 500 characters, then Send. |
| PENDING_CONFIRMATION, safety | "The duty manager will confirm this one." and only "Still a problem". No auto-close line, no "Yes, it's fixed" (D39). |
| REOPENED | Read-only: "You said it is still a problem. ..." |
| CLOSED | Read-only: how it was closed (you confirmed, automatically, by the duty manager) and the rating. A safety complaint closed by the duty manager inside the reopen window also has "Still a problem". |

The buttons call `/api/complaints/[id]/confirm` and `/reopen` (`src/lib/complaint-actions.ts` is the reducer). A 409 (STALE or INVALID_TRANSITION: the
complaint changed under the person's feet) shows "This complaint has changed" and Reload. Another flat's id, a missing id and a bad id are the same
not-found page, with nothing of the complaint.

## The safety alert on the Home (D126)

Shown above the dues while the flat has an open safety complaint (the newest one). Pure rule: `safetyAlertState` in `src/domain/complaints/safety-alert.ts`.

| State | When | Words | Call button |
|---|---|---|---|
| 1a SENT | raised, not acknowledged, less than `safety_ack_timeout_minutes` (default 5) ago | "Your fire report has gone to the duty manager". "If anyone is in danger, call now." | "Call duty manager" (`duty_manager_phone`) |
| 1b SEEN | `first_response_at` is set | "The duty manager has seen your report". "Seen at 5:42 pm. If anyone is in danger, call now." | the same |
| 1c NO_ANSWER | not acknowledged and the timeout has passed | "No answer yet". "Call 112 now." | "Call 112": `emergency_services_phone` when configured, else the duty manager's |

Acknowledgement is the duty manager's acknowledge action, which sets `first_response_at` (D54); it wins over the timeout, so a late acknowledgement turns
1c into 1b. With no number configured the alert says so in words and draws no link. The Call link is the one filled control of the Home; **both Pay
buttons (the Home and the dues sheet) are outlined while the alert is shown** (D58), and filled again when it goes (the complaint is closed).

## Lazy auto-close (D120)

`autoCloseQuietly` (`src/server/complaints/auto-close.ts`) runs when the list, the detail and the Home load. A failure is logged as "auto-close failed"
with no data and the page still loads. It never touches a safety complaint.

## What is absent, on purpose

- **The bell and a notifications list** (D55): not built. The SAFETY_ALERT notification is a row for the duty manager; no screen reads it.
- **Duplicate linking and "affects me too"**: not built; `DUPLICATE_LINKED` and `AFFECTED_TOO` events are never shown to a resident.
- **Staff screens** (the board, assign, comment, acknowledge, close): not built. The duty manager acknowledges through the API route only (README).
- Attachments, translation of complaint text, provider adapters, reminders, Hindi and Marathi UI.

## Assumptions

- **A1** The danger question is on the form only. The Emergency sheet's links open the same form; no answer is carried over from the sheet.
- **A2** The alert's category comes from the safety words found in the stored text; a declared danger with no word has none ("Your report").
- **A3** The newest open safety complaint decides the alert; one alert is shown even when several are open.
- **A4** "Seen" means `first_response_at` is set. Any staff action sets it on a non-safety complaint, but a safety complaint reaches the duty manager only,
  and its first action is the acknowledgement.
- **A5** `safety_ack_timeout_minutes` outside 1 to 1,440, or not a whole number, is 5.
- **A6** The empty state of the list is a line of words; the one "Raise a complaint" control above it is the way in (the design image repeats it as a link).
- **A7** The closed section is a `details` element: it needs no script and is collapsed by default.

## Findings

- **HTTP status of the not-found page.** The resident pages sit under `(resident)/loading.tsx`, so the response starts streaming as 200 and `notFound()` is
  drawn as the not-found page with `<meta name="robots" content="noindex">` (the same finding as for redirects, `docs/ui-architecture.md`). The smoke
  test therefore checks the page, not a 404 status; a true 404 would need the check before streaming, which the page-level `requireUser` pattern avoids.
- Under a frozen `DEMO_AS_OF` clock the alert stays at 1a for ever (time never passes); 1c needs the real clock.

## Tests

`tests/lib/complaint-form.test.ts`, `complaint-actions.test.ts` (reducers and answer readers); `tests/ui/complaints-view.test.ts`,
`new-complaint-view.test.ts`, `complaint-view.test.ts`, `safety-alert.test.ts` (every page state, the three alert states, the outlined Pay, one filled
control, 48px targets, no forbidden styling; `token-classes` and `styling-rules` scan the new files too); `tests/domain/complaints/safety-alert.test.ts`,
`tests/server/home-safety-alert.test.ts`; `tests/integration/complaint-home.test.ts` and `complaint-screens.test.ts` (the loaders through the app role);
`complaints-create.test.ts` and `complaints-routes.test.ts` (declared danger); `scripts/smoke-app.mjs` (the screens over HTTP).
