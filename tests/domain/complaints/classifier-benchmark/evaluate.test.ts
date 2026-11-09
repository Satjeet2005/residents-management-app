import { describe, expect, it } from "vitest";
import { BENCHMARK_ITEMS } from "@/domain/complaints/classifier-benchmark/dataset";
import { type ItemResult, d87Verdict, evaluate, percentile, productionPolicy } from "@/domain/complaints/classifier-benchmark/evaluate";
import { defaultClassificationPolicy } from "@/domain/complaints/decision";
import { classifyByKeywords } from "@/domain/complaints/fallback";
import { wilson } from "@/domain/complaints/safety-benchmark/wilson";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency } from "@/domain/complaints/taxonomy";

const en = BENCHMARK_ITEMS.filter((i) => i.languageGroup === "EN");
const answer = (id: string, category: CategoryCode, p: number, urgency: ModelUrgency = "NORMAL", up = 0.9, latencyMs = 100): ItemResult => ({
  id,
  status: 200,
  latencyMs,
  categories: [{ label: category, probability: p }, ...CATEGORY_CODES.filter((c) => c !== category).map((label) => ({ label, probability: (1 - p) / 4 }))],
  urgencies: [{ label: urgency, probability: up }, ...MODEL_URGENCIES.filter((u) => u !== urgency).map((label) => ({ label, probability: (1 - up) / 2 }))],
});
const failed = (id: string): ItemResult => ({ id, status: null, latencyMs: 3000, categories: null, urgencies: null, failure: "TIMEOUT" });
const keywordless = en.filter((i) => classifyByKeywords(i.text).category === null);
const keywordful = en.filter((i) => classifyByKeywords(i.text).category !== null);

describe("BE1 the production policy and the verdict rule", () => {
  it("the policy is the production one: the defaults with one arm allowed", () => {
    expect(productionPolicy).toEqual({ ...defaultClassificationPolicy, allowSingleArm: true });
    expect(defaultClassificationPolicy).toMatchObject({ minCategoryProbability: 0.7, minUrgencyProbability: 0.6 });
  });

  it("D87: accuracy among accepted at least 0.90 AND accepted share at least 0.60, at the exact boundaries", () => {
    expect(d87Verdict(89, 100, 100)).toBe("FAIL");
    expect(d87Verdict(90, 100, 100)).toBe("PASS");
    expect(d87Verdict(59, 59, 100)).toBe("FAIL");
    expect(d87Verdict(60, 60, 100)).toBe("PASS");
    expect(d87Verdict(0, 0, 100)).toBe("FAIL");
    expect(d87Verdict(0, 0, 0)).toBe("FAIL");
  });

  it("the Wilson interval is the safety benchmark's: 9 of 10 is 0.596 to 0.982", () => {
    const interval = wilson(9, 10);
    expect(interval.lo).toBeCloseTo(0.5958, 3);
    expect(interval.hi).toBeCloseTo(0.9821, 3);
  });

  it("percentile is the nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("BE2 the arms on hand-built results", () => {
  const items = en.slice(0, 6);
  const [a, b, c, d, e, f] = items;
  const results = [
    answer(a.id, a.category, 0.95, a.urgency, 0.9),
    answer(b.id, b.category, 0.95, b.urgency, 0.9),
    answer(c.id, c.category === "OTHER" ? "LIFT" : "OTHER", 0.92, c.urgency, 0.9),
    answer(d.id, d.category, 0.65),
    failed(e.id),
    answer(f.id, f.category, 0.9, f.urgency, 0.5),
  ];
  const all = evaluate({ items, results }).groups.ALL;

  it("accepts a confident answer, refuses one under 0.70, and counts a failure as not accepted", () => {
    expect(all.n).toBe(6);
    expect(all.jev.category.accepted.k).toBe(4);
    expect(all.jev.category.accuracyAmongAccepted).toMatchObject({ k: 3, n: 4 });
  });

  it("accepts the urgency apart: an urgency under 0.60 is not accepted, and both needs both", () => {
    expect(all.jev.urgency.accepted.k).toBe(3);
    expect(all.jev.bothAccepted.k).toBe(3);
  });

  it("the production arm uses Jev if accepted, else the keywords, else a person", () => {
    expect(all.production.autoClassified.k + all.production.sentToPerson.k).toBe(6);
    expect(all.production.autoClassified.k).toBeGreaterThanOrEqual(4);
  });

  it("every proportion carries a Wilson interval inside 0 to 1", () => {
    for (const p of [all.jev.category.accepted, all.jev.category.accuracyAmongAccepted, all.keyword.category.accepted, all.production.autoClassified]) {
      expect(p.lo).toBeGreaterThanOrEqual(0);
      expect(p.hi).toBeLessThanOrEqual(1);
      expect(p.lo).toBeLessThanOrEqual(p.rate);
      expect(p.rate).toBeLessThanOrEqual(p.hi);
    }
  });
});

describe("BE3 the keyword arm and the person", () => {
  it("an item with no keyword and a refused Jev answer goes to a person", () => {
    const item = keywordless[0];
    expect(item).toBeDefined();
    const group = evaluate({ items: [item], results: [answer(item.id, item.category, 0.5)] }).groups.ALL;
    expect(group.production).toMatchObject({ autoClassified: { k: 0 }, sentToPerson: { k: 1 } });
    expect(group.keyword.category.accepted.k).toBe(0);
  });

  it("an item with a keyword and a refused Jev answer is classified by the keywords", () => {
    const item = keywordful[0];
    const group = evaluate({ items: [item], results: [failed(item.id)] }).groups.ALL;
    expect(group.production.autoClassified.k).toBe(1);
    expect(group.keyword.category.accepted.k).toBe(1);
  });
});

describe("BE4 the confusion matrices and the most confident wrong answers", () => {
  const items = en.slice(0, 4);
  const wrong = (item: (typeof items)[number]): CategoryCode => (item.category === "OTHER" ? "LIFT" : "OTHER");
  const results = [answer(items[0].id, items[0].category, 0.99), answer(items[1].id, wrong(items[1]), 0.8), answer(items[2].id, wrong(items[2]), 0.97), answer(items[3].id, wrong(items[3]), 0.97)];
  const out = evaluate({ items, results });

  it("counts truth against prediction, accepted answers only", () => {
    const total = CATEGORY_CODES.flatMap((t) => CATEGORY_CODES.map((p) => out.confusion.jev[t][p])).reduce((x, y) => x + y, 0);
    expect(total).toBe(4);
    expect(out.confusion.jev[items[0].category][items[0].category]).toBeGreaterThanOrEqual(1);
    expect(out.confusion.jev[items[1].category][wrong(items[1])]).toBeGreaterThanOrEqual(1);
  });

  it("lists the wrong answers, the most confident first, ties by id", () => {
    expect(out.confidentWrong.map((w) => w.id)).toEqual([...[items[2].id, items[3].id].sort(), items[1].id]);
    expect(out.confidentWrong[0].probability).toBeCloseTo(0.97, 5);
    expect(out.confidentWrong.at(-1)?.probability).toBeCloseTo(0.8, 5);
  });

  it("keeps at most 20", () => {
    const many = en.slice(0, 20).concat(BENCHMARK_ITEMS.filter((i) => i.languageGroup === "HI").slice(0, 10));
    const wrongs = many.map((i) => answer(i.id, i.category === "OTHER" ? "LIFT" : "OTHER", 0.9));
    expect(evaluate({ items: many, results: wrongs }).confidentWrong).toHaveLength(20);
  });
});

describe("BE5 latency, availability and nothing at all", () => {
  it("p50 and p95 are over the successful answers, and availability is successes over attempts", () => {
    const items = en.slice(0, 4);
    const results = [answer(items[0].id, items[0].category, 0.9, "NORMAL", 0.9, 100), answer(items[1].id, items[1].category, 0.9, "NORMAL", 0.9, 300), answer(items[2].id, items[2].category, 0.9, "NORMAL", 0.9, 200), failed(items[3].id)];
    const out = evaluate({ items, results });
    expect(out.latency).toEqual({ p50: 200, p95: 300 });
    expect(out.availability).toMatchObject({ k: 3, n: 4 });
  });

  it("with no results every count is zero, the verdicts fail and nothing is invented", () => {
    const out = evaluate({ items: en, results: [] });
    expect(out.groups.ALL.n).toBe(0);
    expect(out.groups.ALL.jev.category.verdict).toBe("FAIL");
    expect(out.groups.ALL.production.verdict).toBe("FAIL");
    expect(out.latency).toEqual({ p50: null, p95: null });
    expect(out.availability).toMatchObject({ k: 0, n: 0, lo: 0, hi: 1 });
    expect(out.confidentWrong).toEqual([]);
  });

  it("splits by language group", () => {
    const hi = BENCHMARK_ITEMS.filter((i) => i.languageGroup === "HI").slice(0, 2);
    const out = evaluate({ items: [...en.slice(0, 3), ...hi], results: [...en.slice(0, 3), ...hi].map((i) => answer(i.id, i.category, 0.95, i.urgency)) });
    expect(out.groups.EN.n).toBe(3);
    expect(out.groups.HI.n).toBe(2);
    expect(out.groups.MR.n).toBe(0);
    expect(out.groups.ALL.n).toBe(5);
  });
});
