# Design system: Passbook

Money is shown as ledger lines under a **double rule**. One shared Tracker. Calm
warm paper, ink text, one deep green for action. No gradients, glass, shadows,
emoji, stock imagery, icon-in-coloured-circle, all-caps labels or letter-spacing.

Tokens live in `src/app/globals.css` (Tailwind 4 `@theme`), components in
`src/components/ui`. To see everything, run the app with `SHOW_DESIGN_PAGE=true`
and open `/design` (a 404 otherwise).

## Colour

Contrast is against paper (`#FBF8F1`) and is computed by `tests/ui/token-contrast.test.ts`
from the hex values it reads out of `globals.css`.

| Token | Hex | Use | Contrast on paper | On paper-2 |
|---|---|---|---|---|
| `paper` | `#FBF8F1` | ground | n/a | n/a |
| `paper-2` | `#F1EBDC` | chips, placeholders, notices (assumption A1) | n/a | n/a |
| `ink` | `#1C1A17` | text, the rule | 16.37:1 | 14.60:1 |
| `ink-2` | `#57514A` | secondary text | 7.38:1 | 6.59:1 |
| `accent` | `#0E4F47` | primary action, tracker, links | 8.89:1 | 7.92:1 |
| `caution` | `#9A3B0A` | overdue and warnings, always with words | 6.59:1 | 5.88:1 |
| `control` | `#6B6558` | outlined controls, empty tracker markers | 5.46:1 | 4.87:1 |
| `hairline` | `#8D8676` | 1px ruled lines (a line, not text) | 3.41:1 | n/a |
| `white` | `#FFFFFF` | text on accent | 9.43:1 on accent | n/a |

Paper on accent is 8.89:1. Anything not in this table is switched off in the
theme (`--color-*: initial`), so a screen cannot use a default colour.

## Type

IBM Plex Sans with IBM Plex Sans Devanagari, weights **400 and 600 only**.

| Token | Size / line height (Latin) | Devanagari line height | Use |
|---|---|---|---|
| `text-caption` | 14 / 21 | 14 / 22.4 | dates, captions, tags |
| `text-body` | 16 / 24 | 16 / 25.6 | body |
| `text-title` | 20 / 30 | 20 / 32 | section titles |
| `text-heading` | 24 / 36 | 24 / 38.4 | screen headings, large amounts |
| `text-hero` | 40 / 48 | 40 / 64 | the one big amount |

`tnum` (`font-variant-numeric: tabular-nums`) is used for every amount and date.

Fonts are self-hosted (`src/app/fonts.ts`, `next/font/local`, `display: swap`)
from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-devanagari`
5.3.0, the official IBM Plex release under the SIL Open Font License 1.1. The
build copies the files; nothing is fetched from a network. Each script subset is
its own font with its own `unicode-range`:

| File (weights 400 and 600) | Size 400 / 600 | Loads when the page shows |
|---|---|---|
| Latin | 22,588 / 24,252 bytes | basic Latin, digits, punctuation (preloaded) |
| Latin Extended | 15,980 / 16,448 bytes | the rupee sign U+20B9 and accented letters |
| Devanagari | 77,448 / 79,176 bytes | Hindi or Marathi |

Together 235,892 bytes for the six files; a page of English with rupee amounts
loads four of them (Latin and Latin Extended), about 79 KB.

`:lang(hi)` and `:lang(mr)` (and everything inside them) get line height 1.6,
`letter-spacing: 0` and `text-transform: none`. Put `lang="hi"` or `lang="mr"` on
the element that holds the text.

## Space, size, shape, motion

- **Spacing steps** 4, 8, 12, 16, 24, 32 px (`1, 2, 3, 4, 6, 8` on the 4px base).
- **Touch targets** 48px minimum (`min-h-12`), 56px for the primary Pay button
  (`min-h-14`), at least 8px between targets. Always `min-h`, never a fixed height.
- **Radius** 8px for controls (`rounded-control`), 12px for sheets (`rounded-sheet`).
- **Double rule** two 2px ink lines with a 3px gap (7px in all).
- **Motion** 100 to 260 ms, ease-out (`--motion-quick`, `--motion-base`,
  `--motion-slow`, `--motion-ease`). Under `prefers-reduced-motion` all transitions
  and animations are off.
- **Focus** a 3px accent ring, 2px away from the edge, on every `:focus-visible`.

## Components

| Component | States and variants | Accessibility |
|---|---|---|
| `Button` | primary (filled accent, white text), outlined (control border), link (underlined accent); default 48px, large 56px; disabled (dashed outline, grey text); loading (a word replaces the label) | native `<button>`, `type="button"` unless set, `disabled`, `aria-busy` when loading |
| `StatusTag` | neutral, caution, positive; optional icon | always words; the icon is `aria-hidden`; min-height, never fixed |
| `DoubleRule`, `Hairline` | n/a | the double rule is decorative (`aria-hidden`); the hairline is an `<hr>` |
| `Money` | hero 40/48, large 24/36, body 16/24 | integer paise through `formatRupees` (₹6,468, ₹1,23,456), tabular numerals |
| `LedgerLine` | date, particulars (wrap), amount right | an `<li>`; put lines in a `<ul>` |
| `LedgerTotal` | label, large amount, then a double rule | n/a |
| `Tracker` | 3 or 4 steps; done (check), current (thick ring), upcoming (hollow); connector solid after done, dashed after the others | `<ol>`, `aria-current="step"`, "Step n of m" as text, a spoken "Done: / Current: / Next: " before each label |
| `SectionHeader` | title, optional link | a heading (h2 or h3); the link is 48px tall |
| `Sheet` | open, closed; with or without footer; from the bottom (default) or from the top (`fromTop`) | native `<dialog>` + `showModal()`: focus trap, Escape, backdrop tap and Close button close it, focus returns to the opener (without scrolling the page), `aria-labelledby` the title; while open the page behind is locked (D184) |
| `Skeleton` | n plain bars | `aria-busy="true"`, "Loading" for screen readers, no shimmer |
| `BlockError` | message, optional consequence, Try again | `role="alert"`; the retry is a 48px button |
| `Notice` | status, alert | `role="status"` (news) or `role="alert"` (needs attention); always words |

Not built here: screens, auth, data fetching, the payment-confirmed animation.

## Sheet behaviour (D184)

Every sheet goes through the one `Sheet` component, so every sheet behaves the same. While one is open the page behind does not scroll: `src/lib/scroll-lock.ts` fixes the body at the current scroll position, keeps the scrollbar gutter (no shift on a desktop) and, on the last release, restores every style and the exact scroll position. It is reference counted, released on close, Escape and unmount, and only `Sheet` calls it (a test scans the sources). The sheet's body has `overscroll-behavior: contain` and a height of the dynamic viewport less the header, so scrolling inside it never reaches the page. `fromTop` opens it from the top on a phone, for a sheet whose first control must be in the top half of the screen.

## The clutter budget (D185)

A screen that matters (the Emergency sheet is the first) is given a budget that a browser test asserts: how many controls it may have, that the primary action is inside a stated part of the first screen, that exactly one control is filled, that every control is 48px and 8px apart, that nothing is styled as a link that is not one, and axe. "Cluttered" becomes a number that can fail. The protocol is `docs/ui-fix-protocol.md`.

## Rules

- No uppercase and no letter-spacing, anywhere. For Hindi and Marathi this is
  also forced to `0` and `none` by `:lang()` rules.
- Targets are at least 48px, with at least 8px between them.
- Body text is 16px, captions 14px; line height 1.5 for Latin, 1.6 for Devanagari.
- Colour is never the only signal: a disabled button is dashed, a tag has words,
  the tracker has shapes, a notice has text.
- Every affordance is either built or absent: no control that does nothing.
- No shadows, gradients, italics, fixed heights on interactive elements, or
  weights other than 400 and 600. `tests/ui/styling-rules.test.ts` scans for these.

## Assumptions

- **A1.** `paper-2` is `#F1EBDC`, chosen so ink on it is 14.60:1 (at least 12:1)
  and ink-2 on it is 6.59:1.
- **A2.** Radii are 8px for controls and 12px for sheets.
- **A3.** The tracker's done marker is an outlined circle with a check, not a
  filled one, to stay clear of "icon in a coloured circle". Current is a 6px ring.
- **A4.** `white` (`#FFFFFF`) is a token only for text on accent.
- **A5.** Only the Latin, Latin Extended and Devanagari subsets are loaded. The
  Devanagari package's own Latin subsets are not used, because Plex Sans covers
  Latin. The rupee sign comes from Latin Extended (Latin pages) or Devanagari.
- **A6.** The default Tailwind spacing scale (4px base) is kept, so steps other
  than 4, 8, 12, 16, 24, 32 are possible but not used; nothing enforces it.
- **A7.** Hero (40px) and large (24px) amounts are weight 600; body amounts 400.
- **A8.** The duration and easing tokens exist, but the components use only a
  100 ms colour transition; the sheet has no opening animation.
- **A9.** The Hindi and Marathi strings on `/design` are placeholders for a
  rendering test, not reviewed by a native speaker.
- **A10.** The Hindi hero line height is 1.6 x 40 = 64px, as the rule says,
  although the design does not list one.
