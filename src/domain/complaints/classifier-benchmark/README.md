SYNTHETIC DATA. Written by the coding agent. Not reviewed by a native speaker. Ground-truth labels are the author's judgement. Ten items per cell, so confidence intervals are wide.

# Classifier benchmark dataset

200 made-up complaints for a large Pune housing society: 5 categories (PLUMBING, ELECTRICAL, HOUSEKEEPING, LIFT, OTHER) x 4 language groups x 10 items.

- EN: English.
- HI: Hindi in Devanagari.
- MR: Marathi in Devanagari. The wording is different from Hindi (it is not a copy).
- HINGLISH: Hindi written in the Latin script, mixed with English words.

## Urgency label rule

- HIGH: needs same-day action. For example water entering a flat, power out for a whole wing, lifts out of service where elderly people live, a blocked main drain, a gate with no guard.
- NORMAL: a routine repair within days.
- LOW: cosmetic or a convenience.

In every cell exactly 2 items are HIGH, 6 are NORMAL and 2 are LOW. Exactly 2 are `hard`: an unclear wording, two topics in one sentence, or an unusual phrasing. A hard item still has ONE correct category.

## How the file is built

Each cell lists ten sentences. The position decides the label: positions 1 and 2 are HIGH, 3 to 8 NORMAL, 9 and 10 LOW; positions 2 and 6 are the hard ones. Nothing is random, so the order never changes.

## Rules for the text

- 15 to 200 characters. No names, phone numbers, flat codes or emails, so de-identifying a text changes nothing.
- No safety words (fire, gas, a stuck lift, shock): a test checks every text with the safety detector. Safety complaints never go to a model.
- The OTHER category covers noise, parking, stray animals, the gate, the club house and pet nuisance.
