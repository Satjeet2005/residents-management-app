# UI audit: the staff home (/staff)

Protocol: `docs/ui-fix-protocol.md` v1. Screen: `src/app/(staff)/staff/staff-view.tsx`, for Priya Nair (accountant) and Sanjay Pawar (duty manager).
BEFORE screenshots: `docs/screenshots/staff-home-before-priya-360x800.png`, -priya-1280.png, -sanjay-360x800.png, -sanjay-1280.png.

## Before

| # | Observation | Principle | Fix | Severity |
|---|---|---|---|---|
| 1 | It looks like a temporary placeholder: a "Staff" heading, a name, two bare sections. | A home says who you are and what needs you. | The h1 is the role title; strips and cards carry status. | High |
| 2 | Every staff member sees the same screen. | Role-aware. | `roleTitle(permissions)` and one card for each tool the person may use. | High |
| 3 | The only tool is a bare underlined link. | A tool is a card with its state and one clear action. | Cards with status lines, one filled link, at most one secondary link. | High |
| 4 | The permissions list is a whole section. | Secondary information stays out of the way. | A closed `<details>` "What you can do here". | Medium |
| 5 | "Sign out" is a full-width button. | A rare action is small. | Auto-width outlined 48px button. | Medium |
| 6 | The page has a "Staff home" link to itself. | No link to where you are. | The back link is drawn by the staff layout on every other page and not on /staff. | Medium |
| 7 | No status at all. | Show what needs a person. | Live counts from the existing services; attention strips only when a count is above zero. | High |
| 8 | Two thirds of the screen is empty. | Use the first screen. | Heading, signed-in line, strip, first card and its filled link inside the first 800px. | Low |

## Structure chosen (decided by the human)

Role title as h1, "Signed in as", attention strips (duty manager: unseen safety complaints; approver: requests waiting for you), one card per tool (Complaints, Bank statement matching, Committee report), a collapsed permissions list, a small Sign out. Titles are derived from permissions because the data model has no job titles (R112).

## After

AFTER screenshots: `docs/screenshots/staff-home-after-{priya,rahul,sanjay,kavita,meera}-360x800.png`, `staff-home-after-priya-1280.png`.

| # | Observation | Principle | Fix | Evidence |
|---|---|---|---|---|
| 1 | The h1 is the role title for each seeded account: Accountant, Accountant and approver, Committee, Complaints manager, Duty manager. | Role-aware. | `src/domain/auth/role-title.ts`, `src/lib/staff-home.ts`. | `tests/domain/auth/role-title.test.ts` (all five seeded accounts read from the seed source, hostile lists); browser spec. |
| 2 | First screen at 360x800 shows the title, "Signed in as" and the first card's filled link (bottom edge inside 800px) for every account. | First-screen visibility. | Compact layout. | `tests/e2e/screens/staff-home.spec.ts`. |
| 3 | Counts equal independent SQL: Priya and Rahul (queued and waiting totals over all imports), Kavita and Sanjay (needs action, overdue), Sanjay (unseen safety), Rahul (approvals waiting excluding his own requests). | Numbers a person can trust. | `src/server/staff/home-data.ts` (SELECT only). | `tests/integration/staff-home.test.ts` (9 tests) and the browser spec read the scratch database. |
| 4 | Controls: Priya 4 or fewer, Rahul 5 or fewer, Sanjay 5 or fewer; exactly one filled control; Sign out narrower than 300px. | Interactive budget. | Single column, small Sign out. | Browser spec, measured. |
| 5 | A strip appears only above zero and only for the person who holds the permission. | Attention only when needed. | `staff-view.tsx`. | `tests/ui/staff-home.test.ts` (SH3) and the browser spec (Sanjay yes, Kavita and Priya no; Rahul yes). |
| 6 | The committee report loader does not run on the home. | Cheap page. | Static text on the card. | `tests/ui/staff-home.test.ts` (SH4 source scan) and an operation count of at most 8 (10 for a person with every tool) in the integration test. |
| 7 | The permissions toggle had no sign that it opens. | No false affordance. | A chevron on the summary. | Found in the first screenshot; fixed in the same commit. |
| 8 | Axe zero serious or critical; no horizontal overflow at 360, 768 and 1280. | Accessibility. | n/a | `checkScreen` in the browser spec. |

Known small points: "All 1 rows accounted for" keeps the old wording for one row; the secondary link is offset 16px from the filled link because both share the button padding.
