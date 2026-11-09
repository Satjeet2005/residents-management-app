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
- [ ] Text overlap: `assertNoTextOverlap(locator, label)` from `tests/e2e/helpers/overlap.ts` passes for every card and every chart at 360, 768 and 1280. It fails when two texts intersect, when a drawn line crosses a text, when a text is outside its element, or when a clipping ancestor cuts a text, and the message names the texts. Its rules (`tests/e2e/helpers/overlap-rules.ts`) are unit tested, with the box layout of an old design as a fixture that must fail.
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

## Skill usage note (UI-BATCH-1)

- **Not available:** `redesign-existing-projects`, `minimalist-ui` and `full-output-enforcement` were not in `~/.claude/skills` (it held only `synced`, with docs, docx and google-workspace). They were NOT used, and nothing was fetched or installed. To use them, the human copies the three skill folders by hand into `~/.claude/skills/<name>/` (each with its `SKILL.md`), outside the repository; never `npx skills add`.
- **Used:** `taste-skill:design-taste-frontend` (tasteskill 2.5.1, from the plugin the human added), read in full. It is a skill for company marketing sites. This version has no DESIGN_VARIANCE, MOTION_INTENSITY or VISUAL_DENSITY settings, so the dials 2, 1 and 3 were kept in mind as "calm, almost no motion, low density" and nothing was set.
- **Rules taken from it:** the first screen holds the main action; one main action a screen; headings name things and buttons are a verb and an object; "no fact twice" (the legend and the lane buttons; "Raise a complaint" three times); check in a real browser at several widths and read the screenshots; keep a clear gate (here: `npm run check`, the browser specs and the measured acceptance).
- **Instructions REJECTED because they conflict with the conflict rules:** "a linked card lifts 2px, a photo zooms, buttons step and press, a hero enters on load, a dealt moment on every page" (rule: "NO motion except instant state changes and, at most, a 150 ms opacity or transform transition that is removed under prefers-reduced-motion"); "photographs lead", "real photographs where they fit", "nicer backgrounds" (rule: "no decorative imagery" and "the Passbook identity stays"); "shader effects, scenes, lit panels, CSS grounds" (rule: "NO shadows, gradients, blur or glass"); "real full-colour icons" (rule: "paper and ink with one green accent"); "a dark page or hero" (the Passbook tokens); running the skill's `gate.mjs`, `consistency.mjs` and `start.mjs` scripts (rule: "NEVER run ... any command that installs a skill or a package", and the kit is not in the repository). "One section per screen" and "60 to 80 words a screen" are for marketing pages and were not applied.
- **Did a skill change a decision?** No change. Every structure was decided by the human; the skill's only effect was the checklist above.
