# Staff complaint screens (T13c)

The board, one complaint with its full timeline, and the actions, over the T13a services. They show what the services decided and let a person act;
they add no rule of their own: every change goes through the existing routes of `docs/complaints-design.md` with the version the page was shown with.
Decision: D130 (`docs/decisions.md`), with D14, D15, D39, D54, D73 and D117 to D121 behind it. The resident side is `docs/complaints-ui.md`; the look is
Passbook (`docs/design-system.md`). Every string is in `src/lib/messages/en.ts`.

## Pages

| Address | Who | What it shows |
|---|---|---|
| `/staff` | any active staff | The tools the person may open. **Complaints** (for `complaints:manage`) says how many safety complaints are open, in words, when above zero. |
| `/staff/complaints` | `complaints:manage` | The board. `?lane=needs-triage\|safety\|open\|overdue\|waiting\|closed` picks the lane and is always in the address. |
| `/staff/complaints/[id]` | `complaints:manage` | One complaint, its full timeline and the action panel. |

Every page calls `requireUser({ need: "complaints:manage" })` itself (a layout does not run again between pages), and the loaders in
`src/server/complaints/staff-page-data.ts` check the permission again at the data (`StaffAccessError`); "Load more" is a server action built with
`withPermissionAction("complaints:manage")`. A resident, staff without `complaints:manage` and nobody signed in are turned away
(`tests/server/page-guards.test.ts`, `tests/integration/staff-complaints-data.test.ts` SDATA4, `scripts/smoke-app.mjs`).

## The board

1. **Lanes.** A tablist with the six lanes in this order, each with its count: Needs triage, Safety, Open, Overdue, Waiting for resident, Closed. Arrow
   keys, Home and End move between them; each tab is a link, so the lane is in the address and it works without a script. A complaint can be in several lanes
   (the counts are per lane, `docs/complaints-design.md`).
2. **Which lane opens first.** A lane in the address wins. Without one, the **duty manager** lands on Safety when it has items, and everybody else (and a
   duty manager with nothing open in Safety) on Needs triage (`chooseLane`). The loader reads a second time only when the duty manager's Safety lane is empty.
3. **Rows.** A real table from 768px, stacked cards below: the flat code and the first line of the complaint (a 48px link to its page), category, an
   **urgency tag** (CRITICAL in the caution tone, always with its word), status (staff words: a resolved complaint is "Waiting for resident"), assignee
   ("Unassigned" when none), age ("3 h 5 min"), the **reply clock in words** ("Reply due in 40 min", "Reply overdue by 2 h", "Replied in time") and a small
   **source tag**: Rules, Model, Keywords, Manual, or Needs review (which wins: it is what the person has to do).
4. **Order and paging.** Newest first, then a keyset "Load more" through a server action (25 at a time). A failure shows an error with Try again.
5. **Auto-close** runs when the board loads (D120), quietly: a failure is logged and never breaks the page.
6. **Empty lanes** say "Nothing here. Every complaint is handled." No control on the board is filled.

## One complaint

The first line of the text is the only h1. Then, in this order: for a safety complaint a bordered line ("Safety complaint", and whether the duty manager has
seen it, with the time); the **text in full**; the details (flat, who raised it by name, when, status, category with "Needs review" when it applies, urgency,
assignee); the **reply clock** (state in words, due time, first reply, resolved, closed, reopened); the **classification history** (source, category, urgency,
confidence in words, newest first); and the **full timeline**, oldest first.

The timeline holds every event, internal ones included. Each line says in words whether the resident sees it ("Visible to the resident") or only staff do
("Internal"). The marks follow `residentTimeline` and a test compares the two line by line. Classification, category corrections, acknowledgements, internal
comments and every note are internal; a note on a visible event is a line of its own, marked internal, because the resident sees the event and not the note.

## The action panel and who sees which control

On the right from 1024px (sticky), below the timeline on a narrow screen. The table below is `controlsFor` (`src/lib/staff-complaints/controls.ts`), written
as a table test; the services refuse the rest again.

| Control | Offered when |
|---|---|
| Assign (a select of active staff with `complaints:manage`, and Assign) | NEW, ASSIGNED, IN_PROGRESS, REOPENED |
| Mark in progress | NEW, ASSIGNED, REOPENED |
| Mark resolved (asks for a note of 5 to 500 characters first) | NEW, ASSIGNED, IN_PROGRESS, REOPENED, and **never for a safety complaint** |
| Comment, with the box "Visible to the resident" (**OFF** until ticked) | every status |
| Correct the category (a select of the five, Save; off while it is the same category, unless the complaint waits for review) | every status |
| **I have seen this** (acknowledge) | **the duty manager only**, a safety complaint that is not closed and not yet acknowledged; the ONE filled control while offered |
| **Close this safety complaint** (asks for a note of 5 to 500 characters first) | **the duty manager only**, a safety complaint in NEW, ASSIGNED, IN_PROGRESS or REOPENED |

Nobody else sees the last two, and a person without `complaints:manage` is offered nothing. A test walks every viewer, status, safety flag and
acknowledgement and finds at most one filled control in each view (the acknowledge button, only while it is offered); every other button is outlined.

**What every action does.** It sends the version it was shown with (assign, status and category; a comment, an acknowledgement and a close do not need one).
A second tap while one action is in flight does nothing (the reducer ignores every event but the answer, and a ref guards the handler); the button says
"Working". A 409 (STALE or INVALID_TRANSITION) says "This complaint changed. Reload to see it." with a Reload button; 403, 404, an invalid assignee, a
refused form, the network and the server each have a plain sentence and keep what was written. A success refreshes the page (`router.refresh`) and says what
changed ("Assigned to Kavita Rao.", "Comment posted. Only staff can see it.", "Category changed to Lift.", "Marked as seen.", "Safety complaint closed.").

**Focus and announcements.** Focus goes to the first field of a form that was refused, to the note box when it opens, and to the result line after every
answer. The result line is a live region (`status`, or `alert` for an error). Every field has a label, an error is tied to its field with `aria-describedby`
and `aria-invalid`, and nothing is meant by colour alone (the tags and the "Visible to the resident" and "Internal" marks are words).

## States

Loading skeletons (plain bars, a status line, no heading) for the board and for a complaint; an error boundary for both with Try again that never prints the
error; a not-found page for a complaint address that matches nothing (a missing complaint and a bad id look the same); empty lanes as above.

## What is deliberately absent

| Absent | Why |
|---|---|
| **Duplicate linking** and "affects me too" | Not built (`DUPLICATE_LINKED`, `AFFECTED_TOO` are never created); the timeline can name them if they ever are. |
| **Reminders** and escalation timers | Not built. The reply clock only tells; nothing is sent when it runs out. |
| **A notifications list** | The SAFETY_ALERT notification is a row for the duty manager; no screen reads it (D55). |
| Reassigning from the board, bulk actions, search | Out of this task; one complaint at a time, from its page. |
| Hindi and Marathi, attachments | Out of this task. |

## Assumptions (labelled)

- **SU1.** A safety complaint with no category also appears in Needs triage: the service sets `needs_review` whenever the category is unknown (A6 of
  `docs/complaints-design.md`), and the lanes overlap by design.
- **SU2.** The note of "Mark resolved" is required (5 to 500 characters) in the screen, although the service accepts none: the next person should know what was done.
- **SU3.** "Acknowledged" means an acknowledgement event exists, not that `first_response_at` is set (any staff action sets that on a safety complaint too).
- **SU4.** Comment and category correction are offered in every status, including closed (the services allow them); Assign is offered only where the lifecycle allows it.
- **SU5.** The source tag on the board is the newest classification's source; Needs review overrides it.
- **SU6.** Confidence in words: 0.85 and above High, 0.70 and above Medium, else Low (starting guesses; 0.70 is also the model arm's line in R36).
- **SU7.** "Reply overdue by" counts from the due time to now, also for a complaint marked resolved after its due time.
- **SU8.** One clock (the business clock, D97) is read once per page; every "Reply due in" and every age on it is worked out from that instant.
- **SU9.** The board shows the first line of the complaint as well as the columns the task lists: a row of codes alone cannot be triaged.
- **SU10.** The pages need `complaints:manage` (as the task says). A person who holds only `complaints:duty_manager` can use the API routes but not these
  pages; in the seed the duty manager holds both.
- **SU11.** An id in an event that the loader cannot name reads as "someone".
- **SU12.** The limits (a comment of 1,000 characters, a note of 5 to 500) are constants in `src/lib/staff-complaints/panel.ts` that the services also enforce; the sentence "Write a note of 5 to 500 characters." in the message catalog states the same numbers, so a change to them is made in both places.

## How the data is read

```
requireUser({ need: "complaints:manage" }) -> loadBoardPage / loadBoardMore / loadComplaintPage / loadStaffLanding -> pure views
```

The loaders call `listBoard`, `getStaffComplaint` and `listStaffUsers` of T13a and add only reads the app role already has: no privilege was added. The pure
logic is in `src/lib/staff-complaints/` (lanes, time words, labels and tags, the control table, the timeline, the panel reducer) and is unit tested
(`tests/lib/staff-complaints/`). The actions go to the existing routes (`/api/staff/complaints/[id]/assign|status|comment|category|acknowledge|close`).

## What is not tested here

The look at 1280px and 360px, where focus lands, the arrow keys on the tabs and the sticky panel need a person and a browser (the commands are in the README,
"Walking the complaints board"). The render tests (`tests/ui/staff-complaint*.test.ts`, `staff-complaints-*.test.ts`) check the markup of every component and
state; the reducer, the control table and the timeline are unit tested; the loaders run as the app role (`tests/integration/staff-complaints-data.test.ts`);
the screens over HTTP are `scripts/smoke-app.mjs`. A click is not simulated anywhere: no DOM library is installed and none was added.
