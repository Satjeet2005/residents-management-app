import { dayStartInstant } from "../time/calendar";
import { FIRST_NAMES, LAST_NAMES } from "./names";
import type { Prng } from "./prng";
import { DEMO_AS_OF, DEMO_NOW, type DemoFlat, type DemoVisitorPass, type VisitorStatus } from "./types";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const FLATS_WITH_PASSES = 150;
const PURPOSES = ["Family visit", "Friend visit", "Delivery", "Plumber", "Electrician", "Tutor", "Cab pickup", "Guest stay"];
const SAMPLE_FLAT_CODE = "T12-0408";

type Weighted = { value: VisitorStatus; weight: number }[];
const PAST_DAY: Weighted = [
  { value: "DEPARTED", weight: 85 },
  { value: "CANCELLED", weight: 15 },
];
const TODAY_BEFORE_NOW: Weighted = [
  { value: "ARRIVED", weight: 40 },
  { value: "DEPARTED", weight: 45 },
  { value: "CANCELLED", weight: 15 },
];
const TODAY_AFTER_NOW: Weighted = [
  { value: "EXPECTED", weight: 90 },
  { value: "CANCELLED", weight: 10 },
];

/** T12-0408 has two visitors expected today; about 150 other flats have one to three passes today or earlier. */
export function buildVisitorPasses(rng: Prng, flats: readonly DemoFlat[]): DemoVisitorPass[] {
  const today = dayStartInstant(DEMO_AS_OF);
  const sampleFlat = flats.find((f) => f.code === SAMPLE_FLAT_CODE);
  if (sampleFlat === undefined) throw new RangeError(`Flat ${SAMPLE_FLAT_CODE} is missing`);
  const passes: DemoVisitorPass[] = [
    { flatKey: sampleFlat.key, visitorName: "Ramesh Gupta", expectedAt: today + 11 * HOUR, purpose: "Family visit", status: "EXPECTED" },
    { flatKey: sampleFlat.key, visitorName: "Anita Singh", expectedAt: today + 16 * HOUR + 30 * MINUTE, purpose: "Friend visit", status: "EXPECTED" },
  ];

  const others = flats.filter((f) => f.code !== SAMPLE_FLAT_CODE);
  for (const flat of rng.fork("visitors:flats").shuffle(others).slice(0, FLATS_WITH_PASSES)) {
    const r = rng.fork(`visitors:${flat.code}`);
    const count = r.int(1, 3);
    for (let i = 0; i < count; i++) {
      const expectedAt = today - r.int(0, 13) * DAY + r.int(8, 21) * HOUR + r.int(0, 59) * MINUTE;
      const odds = expectedAt < today ? PAST_DAY : expectedAt <= DEMO_NOW ? TODAY_BEFORE_NOW : TODAY_AFTER_NOW;
      passes.push({
        flatKey: flat.key,
        visitorName: `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`,
        expectedAt,
        purpose: r.pick(PURPOSES),
        status: r.weighted(odds),
      });
    }
  }
  return passes;
}
