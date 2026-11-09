# The definitions transfer table (D207)

Part 3 of Round A retired the "About these numbers" block of the committee overview (about 616 words in 12 paragraphs, plus the toggle "What each figure means"). Part 1 lists EVERY sentence of it, verbatim, with its catalog key (as it was in `src/lib/messages/en.ts` at commit `52edee8`) and where it went. Part 2 lists every figure label of every committee page and the line that defines it. The full definitions are in `docs/committee-report.md`, section "Definitions".

A destination is a line of the "What do these mean?" expander of ONE page (`<details data-definitions>`, at most 9 lines of at most 25 words, built from the figure registry `src/lib/reports/figures.ts`), or DROPPED with the reason. The expander lines of the other pages are measured by `tests/ui/committee-text-budget.test.ts`; Part 1 was checked by reading.

## Part 1: every sentence of the old block

| # | Catalog key (removed) | Sentence, verbatim | Destination |
|---|---|---|---|
| 1 | `committee.about.definitions` | What each figure means | DROPPED: the toggle of the retired block; every page has its own "What do these mean?" expander. |
| 2 | `committee.about.heading` | About these numbers | DROPPED: the heading of the retired block. |
| 3 | `committee.about.asOf` | All figures are as of {date}. | DROPPED: the as-of date is the line "As of <date>" under every h1. |
| 4 | `committee.about.asOf` | Every number is worked out from the ledger and the complaint records when the page opens. | Overview expander, line 1 (`committee.def.general`): "Every figure is worked out from the ledger and the complaint records when the page opens." |
| 5 | `committee.about.money` | Billed is the sum of the month's bills. | Collections expander, line 1 (`committee.def.billed`): "Billed: the maintenance bills raised for the month." |
| 6 | `committee.about.money` | Collected is the bill amount without late fee that has been paid, never a late fee. | Collections expander, line 2 (`committee.def.collected`): "Collected: payments received for those bills, not counting late fees." |
| 7 | `committee.about.money` | Still unpaid is the bill amount without late fee still owed, so Billed equals Collected plus Still unpaid. | Collections expander, line 3 (`committee.def.unpaid`): "Still unpaid: the part of those bills not yet paid." ("Billed equals Collected plus Still unpaid" is what the ledger itself shows.) |
| 8 | `committee.about.fees` | Late fees received is real money: a fee that was charged and has been paid. | Dues expander, line 5 (`committee.def.duesReceived`) and Collections expander, line 4 (`committee.def.lateFeesReceived`) |
| 9 | `committee.about.fees` | Charged but unpaid is a fee that was charged and is still owed. | Dues expander, line 6 (`committee.def.duesCharged`) |
| 10 | `committee.about.fees` | Building up is a calculation of what unpaid bills owe today, not yet charged and not money received. | Dues expander, line 7 (`committee.def.duesBuilding`) |
| 11 | `committee.about.owed` | Total owed is the unpaid bills plus the late fees owing on every open bill of every month, in age groups counted from each bill's due date. | Dues expander, line 1 (`committee.def.owedTotal`) and Overview expander, line 3 (`committee.def.cardOwed`) |
| 12 | `committee.about.owed` | A flat appears in every age group where it has a bill, so the flats of the groups add up to more than the different flats in all. | Dues expander, line 3 (`committee.def.ageGroups`) |
| 13 | `committee.about.onTime` | Bills paid by the due date is the bills of the month paid in full on or before their due date, out of ALL the month's bills that are due so far (an unpaid bill past its due date counts against it; a bill not yet due is left out). | Collections expander, line 5 (`committee.def.paidByDue`) and Overview expander, line 4 (`committee.def.cardOnTime`). The parenthesis is shortened: "a bill not yet due" is already out of "due so far"; the full rule is in `docs/committee-report.md`. |
| 14 | `committee.about.ofPaid` | Of bills that were paid, paid on time uses only the bills that have been paid in full as its total, so it ignores the unpaid bills and is always the higher figure. | Collections expander, line 6 (`committee.def.paidOfPaid`), computed: "Of bills that were paid, 88% were paid on time (1,687 of 1,915). This ignores the 484 bills not yet paid." "Always the higher figure" is DROPPED (a consequence, not a definition). |
| 15 | `committee.about.median` | Typical (the middle value) is the value in the middle when the figures are put in order; with an even count it is the lower of the two middle ones. | Collections expander, line 7 (`committee.def.medianDays`), Complaints expander, line 1 (`committee.def.firstReply`) and Complaints expander, line 3 (`committee.def.resolved`): the words are "Half of ... within" and "the middle value of ..."; the even-count rule (the lower of the two middle ones) stays in `docs/committee-report.md` only. |
| 16 | `committee.about.median` | Typical days to pay counts from the day the bill was issued to the day it was paid in full. | Collections expander, line 7 (`committee.def.medianDays`): "... the days from the day each bill was issued." |
| 17 | `committee.about.curve` | The share of the month's money collected by the due date, by day 20 and today counts part payments by their rupees. | Collections expander, line 8 (`committee.def.moneyByDue`): counted in rupees; "by day 20 and today" are in the chart table. |
| 18 | `committee.about.curve` | It can differ slightly from the bills figure, which counts whole bills. | Collections expander, line 8 (`committee.def.moneyByDue`): "It can differ slightly from the bills figure." |
| 19 | `committee.about.monthly` | Every month is measured at the same age: the share of its bills paid within 20 days of the bill. | Collections expander, line 9 (`committee.def.within20`): "... so every month is compared at the same age." |
| 20 | `committee.about.monthly` | A month younger than 20 days is marked "so far". | DROPPED: the takeaway and the bars say "so far" themselves for a young month. |
| 21 | `committee.about.monthly` | A month's share today is also in the table, but older months always look better today because they have had longer to pay. | DROPPED: it explained a comparison of "today" shares that the page no longer makes; the chart table still holds both measures. |
| 22 | `committee.about.sla` | Replies within our promised time are first replies at or before the promised time (set by the society for each urgency), out of the complaints that were replied to or whose promised time has passed. | Complaints expander, line 2 (`committee.def.repliedInTime`) and Overview expander, line 5 (`committee.def.cardReplied`) |
| 23 | `committee.about.sla` | A late first reply counts as missed, and a complaint not yet due is left out. | Complaints expander, line 2 (`committee.def.repliedInTime`): "A complaint not yet due is left out." (A late first reply counts as missed: the line says "within the promised time".) |
| 24 | `committee.about.sla` | The small line on the card is the same figure for each of the last six months. | DROPPED: the sparklines on the cards are retired (D181); "the small line on the card" no longer exists. |
| 25 | `committee.about.complaints` | Complaints are counted in the month they were raised, and raised equals closed plus still open. | Complaints expander, line 8 (`committee.def.ledger`): "In each list, the lines add up to the total raised." "Counted in the month they were raised" is in the h2 "Where <Month>'s complaints stand". |
| 26 | `committee.about.complaints` | Closed automatically means the system closed it after the resident did not reply. | Complaints expander, line 5 (`committee.def.closedAuto`): the number of days comes from the `auto_close_days` setting, never from the text. |
| 27 | `committee.about.complaints` | Typical time until marked resolved is the first time each was marked resolved. | Complaints expander, line 3 (`committee.def.resolved`) |
| 28 | `committee.about.complaints` | Reopened is out of the complaints that were marked resolved. | Complaints expander, line 4 (`committee.def.reopened`) |
| 29 | `committee.about.safety` | A safety complaint is seen when the duty manager acknowledged it or closed it. | Complaints expander, line 7 (`committee.def.seen`) |
| 30 | `committee.about.safety` | The strip at the top and the line "Open and not yet seen, all months" count the open ones nobody has acknowledged, whatever month they were raised in; the other safety figures are for the month chosen. | DROPPED: the all-months row now appears only when it differs from the month's line, and its own label says "all months"; the strip at the top is self-explanatory. |
| 31 | `committee.about.bank` | Bank statement matching covers the last 30 days of imported bank statements. | Bank expander, line 1 (`committee.def.bankWindow`) |
| 32 | `committee.about.bank` | Matched automatically means the system matched the payment to a flat without a person. | Bank expander, line 2 (`committee.def.bankAuto`) |
| 33 | `committee.about.bank` | Waiting for approval means a person matched it and a second person must approve it. | Bank expander, line 5 (`committee.def.bankApproval`) |
| 34 | `committee.about.bank` | Not maintenance payments are bank entries that are not a flat's maintenance, such as other deposits. | Bank expander, line 6 (`committee.def.bankOther`). THE CODE WINS: the old text said "such as other deposits", but the code sets a row aside when it is a debit, an interest credit, a bank charge or has no amount (`IgnoreKind` in `src/domain/matching/types.ts`), so the line says "money paid out, interest and charges". |

## Part 2: every figure label on every page has a definition line in THAT page's expander

The registry id is the value of `data-figure` on the figure's row; the page's render test fails when a shown id has no line in the expander of the same page.

| Page | Figure label on the page | Registry id | Line in this page's expander |
|---|---|---|---|
| Overview | Money collected for <Month> | `cardCollected` | line 2 |
| Overview | Total still owed, all months | `cardOwed` | line 3 |
| Overview | Paid on time, <Month> (goal Met or Not met) | `cardOnTime` | line 4 |
| Overview | Replied in time, <Month> (goal Met or Not met) | `cardReplied` | line 5 |
| Overview | The standard-targets note | `goalsDefault` | line 6, only while the committee has not set goals |
| Overview | "Look closer" row sentences (Billed ... still to pay; over 90 days; raised, answered in time; need a person) | none | No line: each is a restatement of a figure defined on its own page, and it is a link, not a figure row. Reason written here. |
| Collections | Collected, Still unpaid, Billed (ledger) | `collected`, `unpaid`, `billed` | lines 2, 3, 1 |
| Collections | Late fees received (fact) | `lateFeesReceived` | line 4 |
| Collections | n of n flats have paid in full (fact) | none | No line: it states its own count in words and defines nothing new. Reason written here. |
| Collections | Bills paid by the due date | `paidByDue` | line 5 |
| Collections | Half of paid bills are paid within | `medianDays` | line 7 |
| Collections | Money collected by the due date (and the payment curve) | `moneyByDue` | line 8 |
| Collections | Of bills that were paid (secondary, shown only in the expander) | `paidOfPaid` | line 6 |
| Collections | Collected within 20 days, by month (bars and columns) | `within20` | line 9 |
| Dues | Total owed | `owedTotal` | line 1 |
| Dues | The age groups (and the word Age) | `ageGroups`, `ageMeaning` | lines 3 and 2; line 4 (`ageReconcile`) ties the 1 to 30 days row to the Collections page, only when a group holds exactly the month's unpaid bills |
| Dues | Late fees: Received, Charged, not yet paid, Building up, not yet charged | `duesReceived`, `duesCharged`, `duesBuilding` | lines 5, 6, 7 |
| Dues | Towers with the most unpaid | `towers` | line 8 |
| Complaints | Replied in time | `repliedInTime` | line 2 |
| Complaints | Half of first replies come within | `firstReply` | line 1 |
| Complaints | Half are marked resolved within | `resolved` | line 3 |
| Complaints | Reopened after being marked resolved | `reopened` | line 4 |
| Complaints | Closed by the resident | none | No separate line: "resident closed it" is what the words say; the two closes that need explaining have lines (automatic, duty manager). |
| Complaints | Closed automatically | `closedAuto` | line 5 |
| Complaints | Closed by the duty manager | `closedDuty` | line 6 |
| Complaints | Where <Month>'s complaints stand, Safety complaints (the two ledgers: Still open, Other, Raised) | `ledger` | line 8 |
| Complaints | Open, seen by the duty manager; Half are seen within; Open, not yet seen, all months | `seen` | line 7 |
| Complaints | Replies, week by week (chart) | `weekly` | line 9 |
| Bank | The 30-day window (in the h1 and the ledger) | `bankWindow` | line 1 |
| Bank | Matched automatically | `bankAuto` | line 2 |
| Bank | Matched by hand | `bankHand` | line 3 |
| Bank | Waiting for a person | `bankPerson` | line 4 |
| Bank | Waiting for approval | `bankApproval` | line 5, only when there is one |
| Bank | Not maintenance payments | `bankOther` | line 6 |
| Bank | All n accounted for | `bankAccounted` | line 7, only when every import adds up |
| Bank | The table of manual decisions (Manual match, Approved, Rejected, Ignored) | none | No line: the rows are the decision types, which "Matched by hand" and "Waiting for approval" explain; the table is shown only when a count is above zero. Reason written here. |
