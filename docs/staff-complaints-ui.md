# Staff complaint screens (T13c, reworked in T13h)

The board, one complaint with its full timeline, and the actions, over the T13a services. They show what the services decided and let a person act;
they add no rule of their own: every change goes through the existing routes of `docs/complaints-design.md` with the version the page was shown with.
Decisions: D130, and D151 (the views), D152 (the complaint page) and D153 (the medical and violence safety words) from T13h (`docs/decisions.md`), with D14, D15, D39, D54, D73, D117 to D121, D149 and D150 behind them. The resident side is `docs/complaints-ui.md`; the look is
Passbook (`docs/design-system.md`). Every string is in `src/lib/messages/en.ts`.

## Pages

| Address | Who | What it shows |
|---|---|---|
| `/staff` | any active staff | The tools the person may open. **Complaints** (for `complaints:manage`) says how many safety complaints are open, in words, when above zero. |
| `/staff/complaints` | `complaints:manage` | The board. `?view=` picks one of eight views (default `needs_action`); `?category=`, `?assignee=`, `?urgency=` and `?q=` are the filters. The old `?lane=needs-triage\|safety\|open\|overdue\|waiting\|closed` still works as a name for a view. |
| `/staff/complaints/[id]` | `complaints:manage` | One complaint: header, Details and Timeline tabs (`?tab=details\|timeline`), and the actions (a pinned bar and sheet below 1024px, a side panel from 1024px). |

Every page calls `requireUser({ need: "complaints:manage" })` itself (a layout does not run again between pages), and the loaders in
`src/server/complaints/staff-page-data.ts` check the permission again at the data (`StaffAccessError`); "Show 15 more" is a server action built with
`withPermissionAction("complaints:manage")`. A resident, staff without `complaints:manage` and nobody signed in are turned away
(`tests/server/page-guards.test.ts`, `tests/integration/staff-complaints-data.test.ts` SDATA4, `scripts/smoke-app.mjs`).

## The board (D151)

The staff in the live demo (7 November, seed dated 27 October) found "Needs triage" at 30 rows although most complaints were assigned, rows of about 380px, and
"I have seen this" five screens below the banner that said the duty manager had not seen the complaint. The board is a priority view, not a list of lanes.

### The eight views

All are computed on the server, in the address as `?view=`, and a complaint can be in several (the counts are per view). `needs_action` is for the person who looks.
The same rules are written twice, in `inView` (`src/domain/complaints/board-views.ts`, pure) and in SQL (`src/server/complaints/board-views.ts`); a test compares
both with independent SQL on the seeded database for every view and two viewers.

| View (`?view=`) | A complaint is in it when |
|---|---|
| **Needs action** (`needs_action`, the default) | not closed, and one of: a safety complaint **not acknowledged** by the duty manager; **no assignee**; **status NEW and `needs_review`**; **assigned to the viewer** and either `slaOutcome` is MISSED_OPEN or the status is REOPENED |
| **Mine** (`mine`) | not closed and assigned to the viewer |
| **Safety** (`safety`) | a safety complaint that is not closed, acknowledged or not |
| **Needs triage** (`triage`) | not closed, and (no assignee, **or** status NEW and `needs_review`). Assigned, in-progress and waiting complaints are never in it (D151) |
| **Open** (`open`) | ASSIGNED, IN_PROGRESS or REOPENED |
| **Overdue** (`overdue`) | not closed and `slaOutcome` is MISSED_OPEN: no first reply and the due time has passed. A late first reply or a late "resolved" is not overdue (D150) |
| **Waiting for resident** (`waiting`) | PENDING_CONFIRMATION |
| **Closed** (`closed`) | CLOSED |

"Acknowledged" is the `ack` event written only by the duty manager's `acknowledgeSafety` (D149). `needs_review` is cleared when staff assign a complaint, set its
status or correct its category.

### The order

Every view except Closed: **band** (0 an unacknowledged safety complaint, 1 CRITICAL or HIGH urgency, 2 the rest; a closed complaint is never band 0), then the
**oldest first-reply due time first** (the most overdue first; no due time last), then newest created, then the larger id. Closed: newest closed first. The ranking
is in SQL and the **keyset cursor** carries exactly (band, due time, created, id), so a page never repeats or skips a row, ties included (tested with eight
complaints that tie on every key and pages of 3). Counts for all eight views are ONE query. The page holds 15 complaints.

### Filters and the address

`?category=` (the five codes), `?assignee=me|unassigned|anyone`, `?urgency=` (the four) and `?q=` (a flat-code prefix of 2 to 8 characters, any case, with a
space, hyphen, slash, underscore or dot between tower and number: `t12-04`, `T12 04` and `t1204` are `T12-04`). A value that is not on its list is **ignored**,
never an error and never in the SQL as text (`parseBoardQuery`, `src/lib/staff-complaints/board-query.ts`). The counts of every view follow the filters, so "Showing
15 of 40" is the count of the view. The alert strip does not: it counts every safety complaint that waits for the duty manager.

### What the screen shows

1. **Alert strip** when a safety complaint waits: "<n> safety complaint(s) waiting for the duty manager." linking to the Safety view.
2. **View** button (48px, below 1024px) saying "View: Needs action 9"; it opens a sheet with all eight views, a count and ONE plain sentence each. Choosing one
   closes the sheet and changes the address. From 1024px the same list is a left sidebar. **Filters** button: a sheet with the four filters, Apply and Reset;
   the active filters are removable chips under the header. Escape closes either sheet and focus returns to the button.
3. **Demo note** ("Demo data is dated 27 October, so replies can look overdue.") only when `DEMO_MODE` is exactly `true`.
4. **Compact row** (one tappable card, about 85 to 110px on a phone, at most 120px). Line 1: the flat chip, an urgency chip only when not Normal, a "Safety" chip.
   Line 2: the title on ONE line (ellipsis). Line 3 (14px, secondary ink): "Category · Status · Assignee or Unassigned". Line 4 only when notable: "Reply overdue
   2 h 32 min" with the caution mark, "Reply due in 40 min" when within 4 hours, "Replied late"; nothing for "replied in time". The classification source tags
   ("Model", "Rules", "Needs review") are not on the row; they are on the complaint page.
5. **Table** from 768px: flat, complaint, category, urgency, status, assigned to, reply, age, in the order above.
6. **Show 15 more** and "Showing 15 of <n>"; a failure shows an error with Try again. **Empty** views say "Nothing here. Every complaint is handled." (with a
   filter on: "No complaint matches these filters."). Auto-close runs when the board loads (D120). No control on the board is filled.

## One complaint (D152)

1. **Header**: back link, the title (two lines at most; the only h1), and chips for the flat, the urgency, the status and the reply clock ("Reply overdue 2 h 32 min").
2. **Banner** for a safety complaint, one line: "The duty manager has not seen this yet." or "Seen by the duty manager at <time>." (from the acknowledgement fact).
3. **Tabs**: Details and Timeline (a `tablist`, arrow keys, Home and End; `?tab=` in the address). Both panels are rendered by the server.
   - **Details**: the resident's words first; a two-column grid (Flat, Raised by, Raised, Category, Urgency, Assigned to, Status); the reply clock on one line
     ("Reply overdue 2 h · due 7 Nov, 12:00 pm") with the first reply, resolution, closing and reopenings under it; "How it was classified" as ONE line
     ("Rules · Lift · Critical", with "Needs review" when it applies) and a **Why?** expander (`<details>`) with the history, newest first.
   - **Timeline**: the latest three events, newest first, and **Show all (n)** for the rest. Each event shows the time, a Visible or Internal tag, what happened,
     by whom, and the text of a comment or note.
4. **Actions**, below 1024px: a **pinned bar** fixed to the bottom with the safe-area inset (buttons only, no text input; the page gets bottom padding), and from
   1024px the side panel below.

### The pinned bar (`src/lib/staff-complaints/primary-bar.ts`)

| Viewer and state | Bar |
|---|---|
| duty manager, safety complaint not yet acknowledged (not closed) | **I have seen this** (the ONLY filled control) and an outlined **More** |
| duty manager, safety complaint already acknowledged | outlined **Update** |
| any other staff member who may manage (a plain manager included, on a safety complaint too) | outlined **Update** |
| a closed complaint, or a user without `complaints:manage` | no bar |

**More** and **Update** open the **actions sheet**: a short menu of rows, each opening its own small form, one at a time: Assign, Mark in progress, Mark resolved
(a note is required; never offered for a safety complaint), Add comment (the box "Visible to the resident" is unchecked), Correct category, and for the duty
manager on a safety complaint Close this safety complaint (a note is required). Every validation, the version check and the 409 "This complaint changed. Reload
to see it." are those of the side panel (both use `useStaffActions`). After a success the sheet closes, the page refreshes, a live message in the bar says what
changed, and focus returns to the control that opened the sheet.

## The action panel and who sees which control

On the right from 1024px (sticky); below 1024px the same controls are the actions sheet above, and the panel is not shown. The table below is `controlsFor` (`src/lib/staff-complaints/controls.ts`), written
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
acknowledgement and finds at most one filled control in each of the two layouts, the panel and the bar (the acknowledge button, only while it is offered); every
other button is outlined.

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
error; a not-found page for a complaint address that matches nothing (a missing complaint and a bad id look the same); empty views as above.

## What is deliberately absent

| Absent | Why |
|---|---|
| **Duplicate linking** and "affects me too" | Not built (`DUPLICATE_LINKED`, `AFFECTED_TOO` are never created); the timeline can name them if they ever are. |
| **Reminders** and escalation timers | Not built. The reply clock only tells; nothing is sent when it runs out. |
| **A notifications list** | The SAFETY_ALERT notification is a row for the duty manager; no screen reads it (D55). |
| Reassigning from the board, bulk actions, free-text search | Out of this task; one complaint at a time, from its page. The only search is the flat-code prefix. |
| Hindi and Marathi, attachments | Out of this task. |

## Assumptions (labelled)

- **SU1.** (Replaced by D151.) A safety complaint with no category used to appear in Needs triage because `needs_review` was set; it is now only there while it is unassigned or NEW and unreviewed, and a safety complaint is assigned to the duty manager at once.
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
- **SU13.** (T13h) The order inside a band uses the first-reply due time of every complaint, also one that already has a reply, as the task says; a replied complaint with an old due time therefore sorts ahead of an unreplied one with a later time.
- **SU14.** (T13h) The counts of the views follow the filters (so a total and a list agree); the alert strip does not.
- **SU15.** (T13h) A one-digit tower in the flat search is zero-padded ("t5" is "T05"), and a three-digit unit part too ("t12 408" is "T12-0408"), as the flat-code parser pads them.
- **SU16.** (T13h) The bar's safe-area padding uses `env(safe-area-inset-bottom)`; the app does not set `viewport-fit=cover`, so the inset is zero in most browsers and the bar sits above the system area.
- **SU17.** (T13h) A phone gets no way to comment or correct the category of a closed complaint (there is no bar for it); the side panel from 1024px still offers both.
- **SU12.** The limits (a comment of 1,000 characters, a note of 5 to 500) are constants in `src/lib/staff-complaints/panel.ts` that the services also enforce; the sentence "Write a note of 5 to 500 characters." in the message catalog states the same numbers, so a change to them is made in both places.

## How the data is read

```
requireUser({ need: "complaints:manage" }) -> loadBoardPage / loadBoardMore / loadComplaintPage / loadStaffLanding -> pure views
```

The loaders call `listBoardView`, `getStaffComplaint` and `listStaffUsers` and add only reads the app role already has: no privilege was added. The pure
logic is in `src/lib/staff-complaints/` (views, the query string, the row summary, time words, labels and tags, the control table, the bar, the tabs, the timeline, the panel reducer) and is unit tested
(`tests/lib/staff-complaints/`). The actions go to the existing routes (`/api/staff/complaints/[id]/assign|status|comment|category|acknowledge|close`).

## What is not tested here

The look at 1280px and 360px, where focus lands, the arrow keys on the tabs and the sticky panel need a person and a browser (the commands are in the README,
"Walking the complaints board"). The render tests (`tests/ui/staff-complaint*.test.ts`, `staff-complaints-*.test.ts`) check the markup of every component and
state; the reducer, the control table and the timeline are unit tested; the loaders run as the app role (`tests/integration/staff-complaints-data.test.ts`);
the screens over HTTP are `scripts/smoke-app.mjs`. A click is not simulated anywhere: no DOM library is installed and none was added.
