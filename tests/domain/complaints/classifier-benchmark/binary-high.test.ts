import { describe, expect, it } from "vitest";
import { RECALL_TARGET, type Scored, THRESHOLDS, chooseThreshold, highestThresholdStoring, leaveOneGroupOut, measure, scoreItems, slice, storesHigh } from "@/domain/complaints/classifier-benchmark/binary-high";
import { formatBinaryHigh } from "@/domain/complaints/classifier-benchmark/binary-high-report";
import { BENCHMARK_ITEMS, type BenchmarkItem, LANGUAGE_GROUPS, type LanguageGroup } from "@/domain/complaints/classifier-benchmark/dataset";
import { type ItemResult, productionPolicy } from "@/domain/complaints/classifier-benchmark/evaluate";
import { decideClassification } from "@/domain/complaints/decision";
import { wilson } from "@/domain/complaints/safety-benchmark/wilson";
import { CATEGORY_CODES, type ModelUrgency, urgencyRank } from "@/domain/complaints/taxonomy";

const item = (id: string, languageGroup: LanguageGroup, urgency: ModelUrgency, hard = false): BenchmarkItem => ({ id, text: `The corridor paint is peeling near block ${id}.`, languageGroup, category: "OTHER", urgency, hard });
const result = (id: string, pHigh: number, categoryP = 0.95): ItemResult => ({
  id,
  status: 200,
  latencyMs: 100,
  categories: [{ label: "OTHER", probability: categoryP }, ...CATEGORY_CODES.filter((c) => c !== "OTHER").map((label) => ({ label, probability: (1 - categoryP) / 4 }))],
  urgencies: [{ label: "HIGH", probability: pHigh }, { label: "NORMAL", probability: 1 - pHigh }, { label: "LOW", probability: 0 }],
});
const failure = (id: string): ItemResult => ({ id, status: null, latencyMs: 3000, categories: null, urgencies: null, failure: "TIMEOUT" });
const scoredOf = (rows: readonly (readonly [BenchmarkItem, number])[]): Scored[] => scoreItems({ items: rows.map(([i]) => i), results: rows.map(([i, p]) => result(i.id, p)) }).scored;
const at = (t: number) => ({ kind: "threshold", at: t }) as const;

describe("BH1 the thresholds and the boundary", () => {
  it("are 0.10 to 0.60 in steps of 0.05, eleven of them, equal to their written form", () => {
    expect(THRESHOLDS).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]);
  });

  it("a threshold stores an item whose P(HIGH) is exactly the threshold, and not one just under it", () => {
    const [exact, under] = scoredOf([[item("A", "EN", "HIGH"), 0.15], [item("B", "EN", "HIGH"), 0.1499]]);
    expect(storesHigh(exact, at(0.15))).toBe(true);
    expect(storesHigh(under, at(0.15))).toBe(false);
    expect(storesHigh(under, at(0.1))).toBe(true);
  });

  it("ties: two items with the same P(HIGH) are always stored or missed together", () => {
    const rows = scoredOf([[item("A", "EN", "HIGH"), 0.3], [item("B", "EN", "NORMAL"), 0.3]]);
    for (const t of THRESHOLDS) expect(storesHigh(rows[0], at(t))).toBe(storesHigh(rows[1], at(t)));
  });
});

describe("BH2 the metrics on hand-built results", () => {
  // true HIGH: H1 0.9, H2 0.5, H3 0.2; true NORMAL: N1 0.7, N2 0.1; true LOW: L1 0.55, L2 0.0
  const scored = scoredOf([
    [item("H1", "EN", "HIGH"), 0.9],
    [item("H2", "EN", "HIGH", true), 0.5],
    [item("H3", "HI", "HIGH", true), 0.2],
    [item("N1", "EN", "NORMAL"), 0.7],
    [item("N2", "HI", "NORMAL"), 0.1],
    [item("L1", "HI", "LOW"), 0.55],
    [item("L2", "HI", "LOW"), 0],
  ]);

  it("recall counts only the true HIGH items that are stored HIGH, and lists the missed ones", () => {
    const m = measure(scored, at(0.5));
    expect(m.recall).toMatchObject({ k: 2, n: 3 });
    expect(m.missed.map((s) => s.item.id)).toEqual(["H3"]);
    expect(measure(scored, at(0.6)).missed.map((s) => s.item.id)).toEqual(["H2", "H3"]);
    expect(measure(scored, at(0.1)).missed).toEqual([]);
  });

  it("precision, over-rating and true LOW stored HIGH", () => {
    const m = measure(scored, at(0.5));
    expect(m.precision).toMatchObject({ k: 2, n: 4 });
    expect(m.overRated).toMatchObject({ k: 2, n: 4 });
    expect(m.lowStoredHigh).toBe(1);
    expect(m.trueLow).toBe(2);
  });

  it("the Wilson interval is the safety benchmark's", () => {
    const m = measure(scored, at(0.5));
    expect(m.recall.lo).toBeCloseTo(wilson(2, 3).lo, 12);
    expect(m.recall.hi).toBeCloseTo(wilson(2, 3).hi, 12);
    expect(wilson(9, 10).lo).toBeCloseTo(0.5958, 3);
  });

  it("an empty set gives no items, the whole interval and no division by zero", () => {
    const m = measure([], at(0.3));
    expect(m.recall).toMatchObject({ k: 0, n: 0, rate: 0, lo: 0, hi: 1 });
    expect(m.precision.n).toBe(0);
    expect(m.missed).toEqual([]);
  });

  it("restricts to a group and to the hard or non-hard items", () => {
    expect(slice(scored, "HI", "all").map((s) => s.item.id)).toEqual(["H3", "N2", "L1", "L2"]);
    expect(slice(scored, "ALL", "hard").map((s) => s.item.id)).toEqual(["H2", "H3"]);
    expect(slice(scored, "ALL", "non-hard")).toHaveLength(5);
    expect(measure(slice(scored, "ALL", "hard"), at(0.5)).recall).toMatchObject({ k: 1, n: 2 });
    expect(measure(slice(scored, "MR", "all"), at(0.5)).recall.n).toBe(0);
  });

  it("an item with no usable answer is left out and counted", () => {
    const out = scoreItems({ items: [item("A", "EN", "HIGH"), item("B", "EN", "HIGH"), item("C", "EN", "HIGH")], results: [result("A", 0.9), failure("B")] });
    expect(out.scored.map((s) => s.item.id)).toEqual(["A"]);
    expect(out.noAnswer).toBe(1);
  });

  it("the highest threshold that stores an item", () => {
    expect(highestThresholdStoring(scored[1])).toBe(0.5);
    expect(highestThresholdStoring(scoredOf([[item("Z", "EN", "HIGH"), 0.05]])[0])).toBeNull();
  });
});

describe("BH3 the baseline is the production decision function", () => {
  it("equals decideClassification on the same inputs, over a sweep of P(HIGH) and category confidence", () => {
    for (const categoryP of [0.5, 0.69, 0.7, 0.95]) {
      for (let step = 0; step <= 20; step += 1) {
        const p = step / 20;
        const i = item(`S${step}`, "EN", "NORMAL");
        const r = result(i.id, p, categoryP);
        const decision = decideClassification({ rawText: i.text, arms: [{ arm: "DIRECT", categories: r.categories ?? [], urgencies: r.urgencies ?? [] }], policy: productionPolicy });
        expect(scoreItems({ items: [i], results: [r] }).scored[0].productionHigh).toBe(urgencyRank(decision.urgency) >= urgencyRank("HIGH"));
      }
    }
  });

  it("stores HIGH at 0.60 and not at 0.59, never stores a LOW answer, and loses a HIGH when the category is refused", () => {
    const stored = (p: number, categoryP = 0.95) => scoreItems({ items: [item("X", "EN", "HIGH")], results: [result("X", p, categoryP)] }).scored[0].productionHigh;
    expect(stored(0.6)).toBe(true);
    expect(stored(0.59)).toBe(false);
    expect(stored(0.83, 0.63)).toBe(false);
    const low: ItemResult = { ...result("X", 0), urgencies: [{ label: "LOW", probability: 0.95 }, { label: "NORMAL", probability: 0.05 }, { label: "HIGH", probability: 0 }] };
    expect(scoreItems({ items: [item("X", "EN", "LOW")], results: [low] }).scored[0].productionHigh).toBe(false);
  });

  it("the production rule in a measurement is a rule apart from any threshold", () => {
    const [s] = scoredOf([[item("A", "EN", "HIGH"), 0.59]]);
    expect(measure([s], { kind: "production" }).recall.k).toBe(0);
    expect(measure([s], at(0.55)).recall.k).toBe(1);
  });
});

describe("BH4 leave-one-group-out", () => {
  const group = (g: LanguageGroup, highs: number[], normals: number[] = []): [BenchmarkItem, number][] => [...highs.map((p, i): [BenchmarkItem, number] => [item(`${g}H${i}`, g, "HIGH"), p]), ...normals.map((p, i): [BenchmarkItem, number] => [item(`${g}N${i}`, g, "NORMAL"), p])];

  it("chooses the largest threshold whose recall is at least 0.90, at the exact boundary", () => {
    const nine = scoredOf([...group("EN", [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.3])]);
    expect(RECALL_TARGET).toBe(0.9);
    expect(chooseThreshold(nine)).toBe(0.6);
    const eight = scoredOf([...group("EN", [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.3, 0.3])]);
    expect(chooseThreshold(eight)).toBe(0.3);
  });

  it("when none reaches 0.90, takes the highest recall and the larger threshold among ties", () => {
    const train = scoredOf(group("EN", [0.05, 0.05, 0.05, 0.4]));
    expect(measure(train, at(0.1)).recall.k).toBe(1);
    expect(chooseThreshold(train)).toBe(0.4);
    expect(chooseThreshold(scoredOf(group("EN", [0.01, 0.02])))).toBe(0.6);
  });

  it("no true HIGH in the training set picks the largest threshold and never throws", () => {
    expect(chooseThreshold([])).toBe(0.6);
    expect(chooseThreshold(scoredOf(group("EN", [], [0.9, 0.2])))).toBe(0.6);
  });

  it("the threshold of a fold is chosen WITHOUT the held-out group", () => {
    const scored = scoredOf([...group("EN", [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]), ...group("HI", [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]), ...group("MR", [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]), ...group("HINGLISH", [0.2, 0.2, 0.2, 0.2, 0.2])]);
    const logo = leaveOneGroupOut(scored);
    expect(logo.folds.map((f) => f.heldOut)).toEqual([...LANGUAGE_GROUPS]);
    expect(logo.folds.find((f) => f.heldOut === "EN")?.threshold).toBe(0.2);
    expect(logo.folds.find((f) => f.heldOut === "HINGLISH")?.threshold).toBe(0.6);
    expect(logo.folds.find((f) => f.heldOut === "HINGLISH")?.recall).toMatchObject({ k: 0, n: 5 });
    expect(logo.spread).toEqual({ min: 0.2, max: 0.6, range: 0.4 });
    expect(logo.pooledRecall).toMatchObject({ k: 30, n: 35 });
  });

  it("an empty group gives a fold with no items and a threshold chosen from the rest", () => {
    const logo = leaveOneGroupOut(scoredOf(group("EN", [0.7, 0.7], [0.8])));
    const mr = logo.folds.find((f) => f.heldOut === "MR");
    expect(mr?.recall).toMatchObject({ k: 0, n: 0 });
    expect(mr?.threshold).toBe(0.6);
    expect(logo.pooledOverRated.n).toBe(1);
  });
});

describe("BH5 the report on the real fixture items", () => {
  const items = BENCHMARK_ITEMS.slice(0, 40);
  const results = items.map((i) => result(i.id, i.urgency === "HIGH" ? 0.9 : 0.05));
  const text = formatBinaryHigh(scoreItems({ items, results }));

  it("has the heading, the leave-one-group-out block and the optimism sentence, and is deterministic", () => {
    expect(text).toContain("### Urgency as a same-day detector (40 items scored, 0 without an answer left out)");
    expect(text).toContain("#### Leave-one-group-out threshold choice");
    expect(text).toContain("The selection used the benchmark itself, so these held-out numbers are optimistic.");
    expect(text).toBe(formatBinaryHigh(scoreItems({ items, results })));
  });

  it("has one table for all, non-hard and hard items, with the production row and eleven thresholds for each scope", () => {
    for (const title of ["#### All items", "#### Non-hard items only", "#### Hard items only"]) expect(text).toContain(title);
    expect(text.match(/\| ALL \| production \|/g)).toHaveLength(3);
    expect(text.match(/\| MR \| t = 0\.60 \|/g)).toHaveLength(3);
  });
});
