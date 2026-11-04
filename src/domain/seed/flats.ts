import type { Prng } from "./prng";
import { type DemoFlat, TOTAL_FLATS, TOWER_COUNT } from "./types";

/**
 * Typical flat sizes and their relative weights (they sum to 100, so each is a
 * percentage). The areas are filled by quota, not independent draws, so the
 * mean is the same for every seed: 4%+7%+... of 2,400 flats is whole numbers
 * (96, 168, 264, 432, 528, 408, 288, 168, 48), giving a mean of 1,157.6 sq ft.
 */
export const AREA_WEIGHTS: readonly { areaSqft: number; weight: number }[] = [
  { areaSqft: 650, weight: 4 },
  { areaSqft: 750, weight: 7 },
  { areaSqft: 850, weight: 11 },
  { areaSqft: 980, weight: 18 },
  { areaSqft: 1150, weight: 22 },
  { areaSqft: 1320, weight: 17 },
  { areaSqft: 1500, weight: 12 },
  { areaSqft: 1640, weight: 7 },
  { areaSqft: 1850, weight: 2 },
];

/** Flats the demo scenarios depend on: always present, with these areas. */
export const FORCED_FLAT_AREAS: Readonly<Record<string, number>> = {
  "T07-1203": 1150,
  "T12-0408": 980,
  "T21-1601": 1640,
  "T15-0902": 1320,
  "T03-0702": 1640,
  "T18-1105": 1640,
  "T26-0301": 1640,
};

const FLOORS = 16;
const UNITS_PER_FLOOR = 8;
const TOWERS_WITH_FEWER_FLATS = 8;
const FLATS_PER_TOWER = Math.ceil(TOTAL_FLATS / TOWER_COUNT);

const pad2 = (n: number) => String(n).padStart(2, "0");
const towerOf = (code: string) => code.slice(0, 3);

/** Splits `total` by `weights` in whole numbers, giving leftovers to the largest remainders. */
export function allocateQuotas(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const quotas = weights.map((w) => Math.floor((total * w) / weightSum));
  const order = weights
    .map((w, index) => ({ index, remainder: (total * w) % weightSum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < total - quotas.reduce((s, q) => s + q, 0); i++) quotas[order[i].index]++;
  return quotas;
}

function codesForTower(tower: number, count: number, rng: Prng): string[] {
  const prefix = `T${pad2(tower)}`;
  const forced = Object.keys(FORCED_FLAT_AREAS).filter((code) => towerOf(code) === prefix);
  const others: string[] = [];
  for (let floor = 1; floor <= FLOORS; floor++) {
    for (let unit = 1; unit <= UNITS_PER_FLOOR; unit++) {
      const code = `${prefix}-${pad2(floor)}${pad2(unit)}`;
      if (!forced.includes(code)) others.push(code);
    }
  }
  const chosen = rng.fork(`slots:${tower}`).shuffle(others).slice(0, count - forced.length);
  return [...forced, ...chosen].sort();
}

function assignAreas(codes: readonly string[], rng: Prng): Map<string, number> {
  const areas = new Map<string, number>();
  const forcedPerSize = new Map<number, number>();
  for (const [code, areaSqft] of Object.entries(FORCED_FLAT_AREAS)) {
    areas.set(code, areaSqft);
    forcedPerSize.set(areaSqft, (forcedPerSize.get(areaSqft) ?? 0) + 1);
  }
  const quotas = allocateQuotas(codes.length, AREA_WEIGHTS.map((w) => w.weight));
  const pool: number[] = [];
  AREA_WEIGHTS.forEach(({ areaSqft }, i) => {
    const remaining = quotas[i] - (forcedPerSize.get(areaSqft) ?? 0);
    if (remaining < 0) throw new RangeError(`Forced flats exceed the quota for ${areaSqft} sq ft`);
    for (let n = 0; n < remaining; n++) pool.push(areaSqft);
  });
  const shuffled = rng.fork("areas").shuffle(pool);
  let next = 0;
  for (const code of codes) if (!areas.has(code)) areas.set(code, shuffled[next++]);
  return areas;
}

/** 2,400 flats in 28 towers: 20 towers of 86 and 8 of 85, in code order. */
export function buildFlats(rng: Prng): DemoFlat[] {
  const towers = Array.from({ length: TOWER_COUNT }, (_, i) => i + 1);
  const fewer = new Set(rng.fork("towers").shuffle(towers).slice(0, TOWERS_WITH_FEWER_FLATS));
  const codes = towers.flatMap((tower) => codesForTower(tower, fewer.has(tower) ? FLATS_PER_TOWER - 1 : FLATS_PER_TOWER, rng));
  const areas = assignAreas(codes, rng);
  return codes.map((code) => ({
    key: `flat:${code}`,
    code,
    tower: towerOf(code),
    number: code.slice(4),
    areaSqft: areas.get(code) as number,
  }));
}
