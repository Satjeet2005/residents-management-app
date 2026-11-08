# Committee audit disposition (T14c)

**What the audit was.** `docs/committee-audit-report.md` is a SIMULATED review: five imagined Pune society committee members read screenshots of the live site (8 November 2026) and of a local copy (27 October 2026). It is **not a user study**. Nobody real was asked. It is good evidence about confusing wording and about numbers that disagree, and weak evidence about what real members would do.

**Decisions adopted by the human** (D183): every MUST FIX (M-01 to M-14); S-01, S-02, S-04 to S-11, S-13 to S-17; N-01, N-02; "Choose sections" moved to the bottom, not removed; the towers roll-up (S-03), which met its time rule. **Skipped, with the reason:** S-12 and F-43 (login redirect and wording: a login change), N-03 (Marathi and Hindi labels need a native speaker), F-54 (export or print is a new feature), and "30 days ago" for Total owed (the report keeps no history of it).

## Summary

104 rows: **89 fixed, 11 partly fixed, 4 deferred, 0 declined, 0 not a defect.** Nothing was declined. Each deferred item was deferred by the human, and each partly fixed item says in the last column what remains.

**The three most important number problems the audit found**

1. **The unfair month comparison (F-23).** "Jun 98, Jul 98, Aug 96, Sep 93, Oct 83" looked like a collapse; older months had simply had longer to pay. Months are now compared at the same age, the share paid within 20 days of the bill (D173). On the seed this reads Jun 81, Jul 80, Aug 79, Sep 78, Oct 79 percent, checked against independent SQL.
2. **The SLA card against its own line (F-10).** The card said 85% and its line ended at 68%: the line drew the latest part-week. The line is now the last six months by the same rule, so its last point is the card's figure (D174), tested in unit, integration and browser.
3. **The safety counts (F-15).** The strip said 2 and the section "16 of 16 not acknowledged": 15 of the 16 had been closed by the duty manager. A safety complaint is now seen when acknowledged OR closed by the duty manager, the month's groups add up, and the all-months count beside them is the strip's number (D171).

**Definition decisions:** closing implies seen (D171); complaint counts add up with an "other" line that is never hidden (D172); the same-age month measure (D173); the Replies line is monthly (D174); Total owed is unpaid bills plus late fees (D175); gaps to goals in whole points with a rounding rule (D176); the previous period is named (D177); the moved controls (D178); summaries add information (D179); one age list and a flat-level drill-down (D180); darker small text (D181); towers (D182).

**Tower 12.** The audit's members wanted facts on "Tower 12 never pays". On the seeded (fictional) data Tower 12 owes about the median: 16th of 28 towers, so the page does not support that claim. The roll-up gives the committee the facts instead of the story.

## Every finding and every change

Commit hashes are the short hashes of this branch; `fd0c4d8` is the table-stacking fix found by the browser test.

| ID | What the audit said | Decision | Commit | Reason or note |
|---|---|---|---|---|
| F-01 | Five things before the first number on a phone | FIXED | f2c6bc8 | First screen measured: strip, title, month, two whole cards |
| F-02 | Show button beside the month | FIXED | f2c6bc8 | The month applies when chosen |
| F-03 | Choose sections above the numbers, Save, per device | PARTLY FIXED | f2c6bc8 | Moved to the bottom and applies at once; the choice is still per device and browser, so on a shared tablet one person's hidden sections reach the next (D157) |
| F-04 | 'Collected this month' shows October on 8 Nov | FIXED | fc0e242 | Title names the month |
| F-05 | Rounded and exact amounts repeated, 'billed' missing, 82 vs 83 | FIXED | d0cdc8b, f2c6bc8 | Card says 'billed'; the exact line is hidden on a phone and is in Billed and collected; 83% is exact |
| F-06 | Collected is principal only, explained far away | PARTLY FIXED | fc0e242 | Section and About say it; the card carries no note (the principal-only rule is kept) |
| F-07 | Total owed has no time frame | FIXED | fc0e242 | 'Total still owed, all months' and 'All months, as of <date>' |
| F-08 | Paid on time 70% of what | FIXED | fc0e242 | '70 of every 100 October bills were paid by the due date' |
| F-09 | Mini lines have no scale | FIXED | c0fa281 | Fixed 0 to 100 scale, baseline, labels, and a text line |
| F-10 | SLA card 85% but its line ends at 68% | FIXED | c74124f | Line is the monthly series |
| F-11 | SLA jargon, promise not on the page | FIXED | fc0e242 | Promise line from the settings |
| F-12 | Three goals, no gap | FIXED | 1984894, fc0e242 | 'Goal 90% · 20 points short' |
| F-13 | Cards very tall, summaries repeat | PARTLY FIXED | c0fa281, f2c6bc8 | Summaries add new information; cards compacted on a phone but still about 300 px |
| F-14 | 'last month' wrong or missing on Collected and Total owed | PARTLY FIXED | 1984894 | Period named; Collected compared at the same age; the Total owed comparison is deferred (no history is kept) |
| F-15 | Strip 2 vs section 16 of 16 | FIXED | a9891db | Seen rule (D171), both lines shown |
| F-16 | Strip names no age, tower or action | PARTLY FIXED | a9891db | Text says 'open and not yet seen'; managers already had the link to the safety view; no tower or age added (strip design kept, audit section d) |
| F-17 | '24 of 106 rows posted automatically' reads like failure | FIXED | fc0e242 | One summary that accounts for every entry |
| F-18 | About is at the very bottom | FIXED | fc0e242 | 'What these words mean' pointer under the cards |
| F-19 | committee_goals developer wording | FIXED | fc0e242 | Standard-targets sentence |
| F-20 | Billed, Collected, Principal words | FIXED | fc0e242 | 'Bill amount without late fee' |
| F-21 | Late fee 'accruing' reads as money earned | FIXED | fc0e242 | Three lines: received, charged but unpaid, building up |
| F-22 | Flats or bills; commas | PARTLY FIXED | fc0e242 | Wording and grouping fixed; the money sentence still counts flats because one bill is issued per flat per month |
| F-23 | Months compared unfairly | FIXED | 88c41f9, c0fa281 | Same-age measure (D173) |
| F-24 | May 'No data' unclear | FIXED | c0fa281 | Hidden with a note |
| F-25 | Phone table cut off | FIXED | c0fa281, fd0c4d8 | Three columns; wide tables stack |
| F-26 | Five names for unpaid money | FIXED | fc0e242 | 'Total owed' and 'Still unpaid' |
| F-27 | Each part has a different period | FIXED | fc0e242 | Period line on every card and section |
| F-28 | Age groups three times | FIXED | e26800e | One list |
| F-29 | 817 flats vs 916 in groups | FIXED | 1984894, e26800e | '838 different flats in total' and the note |
| F-30 | Outstanding vs 1 to 30 days | FIXED | e26800e | Reconciling sentence |
| F-31 | See the flats gives no feedback | FIXED | e26800e | Heading takes focus and scrolls into view |
| F-32 | Per bill, oldest first, no total | FIXED | e26800e | Per flat, largest first, heading with total |
| F-33 | No way back | FIXED | e26800e | Back link at the top and bottom |
| F-34 | 70% vs 88% | FIXED | fc0e242 | Labelled; says it ignores the unpaid bills |
| F-35 | 69/79/83 unlabelled | FIXED | fc0e242 | Labelled sentence, by rupees |
| F-36 | 'Median days to pay' wraps | PARTLY FIXED | fc0e242 | Wording changed; the wrap of the value was not re-checked |
| F-37 | First reply two numbers in a cell | FIXED | fc0e242 | Separate rows |
| F-38 | 'Time to marked resolved' wraps | PARTLY FIXED | fc0e242 | Wording changed; the wrap was not re-checked |
| F-39 | Reopened unclear | FIXED | fc0e242 | 'Reopened after being marked resolved' |
| F-40 | Complaint counts do not add up | FIXED | a9891db | D172 |
| F-41 | Bank words unclear | FIXED | fc0e242 | Meanings in About |
| F-42 | 'The 1 import' clumsy, no period | FIXED | fc0e242 | 'All 106 accounted for' and 'Last 30 days' |
| F-43 | Login to report is long, developer text | DEFERRED | — | Human decision: skipped (login wording) |
| F-44 | Close, Save, Show everything | FIXED | f2c6bc8 | One Done button |
| F-45 | Curve: blank third, goal meaning, no note | FIXED | d0cdc8b | Title, due-date label and 'Line stops at today.' |
| F-46 | Weekly chart flat scale, last point differs, duplicate | PARTLY FIXED | c74124f, d0cdc8b | Hollow part-week, values on points, card line is monthly; the 0 to 100 scale is kept |
| F-47 | Laptop cards stretch, white holes | FIXED | d7e7c15 | Sections of a row are the same height |
| F-48 | Inconsistent number style | FIXED | fc0e242 | Counts grouped; lakh and crore for headlines |
| F-49 | Small grey text hard to read | FIXED | d7e7c15 | Darker, 16px goals; a screen-reader and large-text pass were NOT done |
| F-50 | 'Show as a table' repeated | FIXED | fc0e242 | 'See the numbers behind this chart' |
| F-51 | Section names do not say what is inside | FIXED | fc0e242 | New names |
| F-52 | No tower roll-up | FIXED | bfa3f1f | Part 5; Tower 12 is 16th of 28 on the seed, so 'never pays' is not supported |
| F-53 | Cards carry no date or month | FIXED | fc0e242 | Month in the title, as-of date on Total owed |
| F-54 | No print or export | DEFERRED | — | Human decision: skipped |
| D-01 | SLA card vs line (phone) | FIXED | c74124f |  |
| D-02 | Safety, strip vs section | FIXED | a9891db |  |
| D-03 | Flats in total vs age groups | FIXED | 1984894, e26800e |  |
| D-04 | Outstanding vs 1 to 30 days | FIXED | e26800e |  |
| D-05 | Raised vs closed + open | FIXED | a9891db |  |
| D-06 | 70% vs 69% and 88% | FIXED | fc0e242 |  |
| D-07 | Rounded vs exact collected | PARTLY FIXED | d0cdc8b | Card says billed; the exact figure is one tap away, not on the phone card |
| D-08 | 'this month' label vs date | FIXED | fc0e242 |  |
| D-09 | 44 waiting vs 'No manual decisions' | FIXED | fc0e242 |  |
| D-10 | Commas | FIXED | fc0e242 |  |
| T-01 | SLA card vs line (tablet, laptop) | FIXED | c74124f |  |
| T-02 | Safety strip vs section | FIXED | a9891db |  |
| T-03 | Flats | FIXED | 1984894, e26800e |  |
| T-04 | Complaints | FIXED | a9891db |  |
| T-05 | 70% vs 69% | FIXED | fc0e242 |  |
| T-06 | Outstanding vs 1 to 30 days | FIXED | e26800e |  |
| M-01 | Safety counts agree | FIXED | a9891db |  |
| M-02 | SLA line equals card | FIXED | c74124f |  |
| M-03 | Period on every card and section | FIXED | fc0e242 |  |
| M-04 | Late-fee lines | FIXED | fc0e242 |  |
| M-05 | Compare months at the same age | FIXED | 88c41f9, c0fa281 |  |
| M-06 | On-time wording | FIXED | fc0e242 |  |
| M-07 | Complaint counts add up | FIXED | a9891db |  |
| M-08 | First screen: no Show, shorter text, Choose sections moved | FIXED | f2c6bc8 |  |
| M-09 | Gap to goal and targets note | FIXED | 1984894, fc0e242 |  |
| M-10 | One name for unpaid money | FIXED | fc0e242 |  |
| M-11 | Total owed split | FIXED | 1984894, e26800e |  |
| M-12 | Bills per group, different flats in all | FIXED | e26800e |  |
| M-13 | Bank statement matching | FIXED | fc0e242 |  |
| M-14 | Replies within our promised time | FIXED | fc0e242 |  |
| S-01 | Phone table of three columns | FIXED | c0fa281 |  |
| S-02 | Drill-down largest first, back, scroll | FIXED | e26800e |  |
| S-03 | Towers roll-up | FIXED | bfa3f1f | Adopted under the 2.5 hour rule |
| S-04 | Body 16px, darker small text | FIXED | d7e7c15 |  |
| S-05 | Section summaries add information | FIXED | c0fa281 |  |
| S-06 | Mini lines fixed scale and text | FIXED | c0fa281 |  |
| S-07 | Weekly chart values, hollow part-week | FIXED | d0cdc8b, c74124f |  |
| S-08 | Payment curve title, label, note | FIXED | d0cdc8b |  |
| S-09 | May hidden with a note | FIXED | c0fa281 |  |
| S-10 | Previous period named; same-age comparison | PARTLY FIXED | 1984894 | '30 days ago' for Total owed deferred by human decision (no history) |
| S-11 | One number rule | FIXED | fc0e242 |  |
| S-12 | Login redirect | DEFERRED | — | Human decision: skipped |
| S-13 | Sheet applies at once with Done | FIXED | f2c6bc8 |  |
| S-14 | 'See the numbers behind this chart' | FIXED | fc0e242 |  |
| S-15 | Section names | FIXED | fc0e242 |  |
| S-16 | Targets sentence | FIXED | fc0e242 |  |
| S-17 | One list for ages | FIXED | e26800e |  |
| N-01 | Equal-height cards, no holes | FIXED | d7e7c15 |  |
| N-02 | Share of total per age group | FIXED | e26800e |  |
| N-03 | Marathi and Hindi labels | DEFERRED | — | Human decision: skipped; needs a native speaker |
