# UI fix protocol v1

How a single screen is fixed, the same way every time. `docs/design-system.md` and `CLAUDE.md` always win over this file and over any skill.

## 1. What the human provides

1. The screen (route and the role or state that shows the problem).
2. A screenshot of it (or permission to take one with Playwright at 360x800).
3. The problems, in the human's own words.
4. The decisions already made (structure, wording, what must not change). Anything not decided is proposed below, with a recommendation.

## 2. The skills lens and the conflict rules

Skills are an advisory lens only. Read each skill used in full first. If a skill is not installed, say so in the report and continue; never fetch or install one (no `npx skills add`).

CONFLICT RULES (a skill instruction that contradicts any of these is IGNORED and listed in the report):

- The Passbook identity stays (tokens in `src/app/globals.css`, IBM Plex self-hosted, paper and ink with one green accent, the double rule motif).
- NO shadows, gradients, blur or glass.
- NO italics, uppercase transforms or letter-spacing.
- NO emoji.
- NO motion except instant state changes and, at most, a 150 ms opacity or transform transition that is removed under `prefers-reduced-motion`.
- NO new dependency.
- Every string goes through the message catalog (remove unused keys).
- One filled primary control per view.
- Targets at least 48px with at least 8px spacing.
- Body text at least 16px and secondary text at least 14px with at least 4.5:1 contrast.
- Mobile first at 360px.
- Nothing that LOOKS interactive but is not (no underline on plain text, no hairline rows that mimic links).
- No emoji and no decorative imagery.

## 3. Steps

1. **Audit.** BEFORE screenshots (360x800, 360x500, 1280x800). A table: Observation, Principle, Fix, Severity.
2. **Options.** If the human has not decided the structure, draw two structures as ASCII wireframes and recommend one. Do not wait: take the recommendation, record it as an assumption.
3. **Implement.** Smallest change that meets the acceptance list. Pure logic in `src/domain`, strings in the catalog, one component for one job.
4. **Measurable acceptance.** The checklist of section 4, asserted in a Playwright spec (numbers measured in the browser, not judged by eye).
5. **AFTER screenshots** at 360x800, 360x500 and 1280x800 (only the named files are added to git).
6. **Critique pass.** A table: Observation, Principle, Fix, Evidence. Fix what it finds, or say why not.
7. **Decision log.** A row in `docs/decisions.md` (next free number) and assumptions in `docs/assumptions.md`.

## 4. Measurable acceptance checklist (template)

- [ ] Interactive element budget: exactly N controls on the screen (list them).
- [ ] Targets at least 48px tall and wide; at least 8px between neighbours.
- [ ] Text at least 16px (secondary at least 14px); contrast at least 4.5:1 (tokens in `tests/ui/token-contrast.test.ts`).
- [ ] No horizontal overflow at 360, 768 and 1280.
- [ ] axe: zero serious or critical violations.
- [ ] At most one filled control in the view.
- [ ] First-screen visibility: the primary action is inside the first screen at 360x800 (state the measured bottom edge).
- [ ] Nothing styled as a link that is not a link.
- [ ] Loading, empty and error states exist for anything that loads.
- [ ] Keyboard order is sensible; Escape closes overlays and focus returns to the opener.

## 5. What NOT to do

- Do not change a route, a permission or a business rule to make a screen look better.
- Do not add a dependency, an animation library, an icon pack or a font.
- Do not hide clutter behind a collapse when it can be removed.
- Do not repeat a word on one screen for two jobs ("call" as a heading and as a button).
- Do not weaken an existing test to pass; list every test edited because a design changed, and why.
- Do not stage unrelated screenshots; stage only the ones this task created.
- Do not install or fetch a skill.
