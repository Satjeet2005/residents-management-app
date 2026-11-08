import type { SafetyHit } from "../safety";
import { wilson, type Interval } from "./wilson";
import type { BenchmarkItem, NegativeGroup, NegativeItem } from "./types";

export type Detect = (raw: string) => SafetyHit[];
export type Counts = { k: number; n: number };
export type Split<T> = { single: T; double: T };
export type MissCell = { n: number; examples: string[] };

/** Integer counts only, so tallies of several seeds add up exactly. `k` counts what was detected (positives) or falsely alarmed (negatives). */
export type Tally = {
  overall: Split<Counts>;
  byCategory: Split<Record<string, Counts>>;
  byForm: Split<Record<string, Counts>>;
  byOperation: Split<Record<string, Counts>>;
  byRule: Record<string, Counts>;
  byBase: Record<string, Counts>;
  /** Misses by "set|form|operation": how many and the first three texts. */
  misses: Record<string, MissCell>;
  negatives: Counts;
  negativesByGroup: Record<string, Counts>;
  falseAlarmsByRule: Record<string, number>;
  falseAlarms: { text: string; group: NegativeGroup; rules: string[] }[];
};

const EXAMPLES = 3;
const zero = (): Counts => ({ k: 0, n: 0 });
const bump = (map: Record<string, Counts>, key: string, hit: boolean): void => {
  const c = (map[key] ??= zero());
  c.n += 1;
  if (hit) c.k += 1;
};

export const emptyTally = (): Tally => ({
  overall: { single: zero(), double: zero() },
  byCategory: { single: {}, double: {} },
  byForm: { single: {}, double: {} },
  byOperation: { single: {}, double: {} },
  byRule: {},
  byBase: {},
  misses: {},
  negatives: zero(),
  negativesByGroup: {},
  falseAlarmsByRule: {},
  falseAlarms: [],
});

/** Detection means the detector returns at least one hit. */
export function tallyPositives(items: readonly BenchmarkItem[], set: keyof Split<unknown>, detect: Detect): Tally {
  const t = emptyTally();
  for (const item of items) {
    const hit = detect(item.text).length > 0;
    t.overall[set].n += 1;
    if (hit) t.overall[set].k += 1;
    bump(t.byCategory[set], item.category, hit);
    bump(t.byForm[set], item.form, hit);
    for (const operation of item.operations) bump(t.byOperation[set], operation, hit);
    bump(t.byRule, item.ruleId, hit);
    bump(t.byBase, `${item.ruleId}|${item.base}`, hit);
    if (!hit) {
      for (const operation of item.operations) {
        const cell = (t.misses[`${set}|${item.form}|${operation}`] ??= { n: 0, examples: [] });
        cell.n += 1;
        if (cell.examples.length < EXAMPLES) cell.examples.push(item.text);
      }
    }
  }
  return t;
}

/** A hit on a negative is a false alarm. */
export function tallyNegatives(negatives: readonly NegativeItem[], detect: Detect): Tally {
  const t = emptyTally();
  for (const negative of negatives) {
    const rules = detect(negative.text).map((h) => h.rule);
    const alarm = rules.length > 0;
    t.negatives.n += 1;
    if (alarm) t.negatives.k += 1;
    bump(t.negativesByGroup, negative.group, alarm);
    if (alarm) {
      t.falseAlarms.push({ text: negative.text, group: negative.group, rules });
      for (const rule of rules) t.falseAlarmsByRule[rule] = (t.falseAlarmsByRule[rule] ?? 0) + 1;
    }
  }
  return t;
}

const addCounts = (a: Counts, b: Counts): Counts => ({ k: a.k + b.k, n: a.n + b.n });
const mergeCountMaps = (a: Record<string, Counts>, b: Record<string, Counts>): Record<string, Counts> => {
  const out: Record<string, Counts> = { ...a };
  for (const [key, counts] of Object.entries(b)) out[key] = key in out ? addCounts(out[key], counts) : { ...counts };
  return out;
};
const mergeSplit = (a: Split<Record<string, Counts>>, b: Split<Record<string, Counts>>): Split<Record<string, Counts>> => ({
  single: mergeCountMaps(a.single, b.single),
  double: mergeCountMaps(a.double, b.double),
});

export function mergeTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce((a, b) => {
    const misses: Record<string, MissCell> = {};
    for (const [key, cell] of [...Object.entries(a.misses), ...Object.entries(b.misses)]) {
      const into = (misses[key] ??= { n: 0, examples: [] });
      into.n += cell.n;
      into.examples = [...into.examples, ...cell.examples].slice(0, EXAMPLES);
    }
    const falseAlarmsByRule = { ...a.falseAlarmsByRule };
    for (const [rule, n] of Object.entries(b.falseAlarmsByRule)) falseAlarmsByRule[rule] = (falseAlarmsByRule[rule] ?? 0) + n;
    return {
      overall: { single: addCounts(a.overall.single, b.overall.single), double: addCounts(a.overall.double, b.overall.double) },
      byCategory: mergeSplit(a.byCategory, b.byCategory),
      byForm: mergeSplit(a.byForm, b.byForm),
      byOperation: mergeSplit(a.byOperation, b.byOperation),
      byRule: mergeCountMaps(a.byRule, b.byRule),
      byBase: mergeCountMaps(a.byBase, b.byBase),
      misses,
      negatives: addCounts(a.negatives, b.negatives),
      negativesByGroup: mergeCountMaps(a.negativesByGroup, b.negativesByGroup),
      falseAlarmsByRule,
      falseAlarms: [...a.falseAlarms, ...b.falseAlarms],
    };
  }, emptyTally());
}

export type Rated = Counts & Interval;
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
export const rate = ({ k, n }: Counts): Rated => {
  const w = wilson(k, n);
  return { k, n, rate: round6(w.rate), lo: round6(w.lo), hi: round6(w.hi) };
};
const rateMap = (map: Record<string, Counts>): Record<string, Rated> => Object.fromEntries(Object.entries(map).map(([key, c]) => [key, rate(c)]));
const rateSplit = (split: Split<Record<string, Counts>>): Split<Record<string, Rated>> => ({ single: rateMap(split.single), double: rateMap(split.double) });

/** Every number a report shows: recall with a 95 percent Wilson interval for each cell, the false-alarm rate, and the fragile rules, worst first. */
export function summarise(t: Tally) {
  const fragile = (map: Record<string, Counts>, limit: number) =>
    Object.entries(rateMap(map))
      .sort((a, b) => a[1].rate - b[1].rate || b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([key, r]) => ({ key, ...r }));
  return {
    headline: {
      singleOperationRecall: rate(t.overall.single),
      doubleOperationRecall: rate(t.overall.double),
      falseAlarmRate: rate(t.negatives),
    },
    byCategory: rateSplit(t.byCategory),
    byForm: rateSplit(t.byForm),
    byOperation: rateSplit(t.byOperation),
    fragileRules: fragile(t.byRule, 25),
    fragileBasePhrases: fragile(t.byBase, 25),
    falseAlarmsByGroup: rateMap(t.negativesByGroup),
    falseAlarmsByRule: t.falseAlarmsByRule,
    missCount: t.overall.single.n - t.overall.single.k + (t.overall.double.n - t.overall.double.k),
  };
}
