import { describe, expect, it } from "vitest";
import { ADOPTION_RULE_TEXT, adoptionRule, formatComparison } from "@/domain/complaints/classifier-benchmark/compare";
import { BENCHMARK_ITEMS } from "@/domain/complaints/classifier-benchmark/dataset";
import { type ItemResult, evaluate, urgencyDetail } from "@/domain/complaints/classifier-benchmark/evaluate";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency } from "@/domain/complaints/taxonomy";

const items = BENCHMARK_ITEMS.filter((i) => i.category === "PLUMBING" || i.category === "LIFT");
const result = (id: string, category: CategoryCode, urgency: ModelUrgency, up = 0.9): ItemResult => ({
  id,
  status: 200,
  latencyMs: 1,
  categories: [{ label: category, probability: 0.95 }, ...CATEGORY_CODES.filter((c) => c !== category).map((label) => ({ label, probability: 0.0125 }))],
  urgencies: [{ label: urgency, probability: up }, ...MODEL_URGENCIES.filter((u) => u !== urgency).map((label) => ({ label, probability: (1 - up) / 2 }))],
});
/** Right category; the urgency is the truth, or `wrong` for the items in `wrongIds`. */
const answers = (wrong: ModelUrgency | null, wrongIds: ReadonlySet<string>, up = 0.9): ItemResult[] => items.map((i) => result(i.id, i.category, wrong !== null && wrongIds.has(i.id) ? wrong : i.urgency, up));
const everyId = new Set(items.map((i) => i.id));
const evalOf = (results: ItemResult[]) => evaluate({ items, results });

describe("BC1 urgency detail", () => {
  it("counts the confusion and the errors that UNDER-rate urgency", () => {
    const high = items.filter((i) => i.urgency === "HIGH").slice(0, 2);
    const normal = items.find((i) => i.urgency === "NORMAL");
    const low = items.find((i) => i.urgency === "LOW");
    if (normal === undefined || low === undefined) throw new Error("dataset shape");
    const results = [result(high[0].id, high[0].category, "NORMAL"), result(high[1].id, high[1].category, "LOW"), result(normal.id, normal.category, "LOW"), result(low.id, low.category, "NORMAL")];
    const detail = urgencyDetail({ items, results }).ALL;
    expect(detail.confusion.HIGH).toEqual({ HIGH: 0, NORMAL: 1, LOW: 1 });
    expect(detail.confusion.NORMAL.LOW).toBe(1);
    expect(detail.confusion.LOW.NORMAL).toBe(1);
    expect(detail.errors).toBe(4);
    expect(detail.underRated).toBe(3);
  });

  it("a urgency that is not accepted (under 0.60) is not in the matrix", () => {
    const detail = urgencyDetail({ items, results: answers("LOW", everyId, 0.5) }).ALL;
    expect(detail.errors).toBe(0);
    expect(Object.values(detail.confusion).flatMap((row) => Object.values(row)).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("BC2 the pre-registered adoption rule", () => {
  const lowWrong = new Set(items.filter((i) => i.urgency !== "LOW").slice(0, 8).map((i) => i.id));
  const v1 = evalOf(answers("LOW", lowWrong));
  const perfect = evalOf(answers(null, new Set()));

  it("adopts when urgency improves by at least 5 points, urgency accepted stays at 50 percent and the category does not fall", () => {
    const rule = adoptionRule(v1, perfect);
    expect(rule).toMatchObject({ a: true, b: true, c: true, adopt: true });
  });

  it("clause (a) fails when urgency does not improve", () => {
    expect(adoptionRule(v1, v1)).toMatchObject({ a: false, adopt: false });
  });

  it("clause (b) fails when fewer than 50 percent of the urgencies are accepted", () => {
    const unsure = evalOf(answers(null, new Set(), 0.5));
    expect(adoptionRule(v1, unsure)).toMatchObject({ b: false, adopt: false });
  });

  it("clause (c) fails when the category accuracy falls by more than 2 points in a group", () => {
    const wrongCategory = items.slice(0, 20);
    const worse = evalOf(items.map((i) => (wrongCategory.includes(i) ? result(i.id, i.category === "LIFT" ? "OTHER" : "LIFT", i.urgency) : result(i.id, i.category, i.urgency))));
    const rule = adoptionRule(v1, worse);
    expect(rule.c).toBe(false);
    expect(rule.adopt).toBe(false);
  });

  it("the rule text names the three clauses and the thresholds", () => {
    expect(ADOPTION_RULE_TEXT).toContain("at least 5 percentage points");
    expect(ADOPTION_RULE_TEXT).toContain("at least 50 percent");
    expect(ADOPTION_RULE_TEXT).toContain("2 percentage points");
  });

  it("the comparison restricts v1 to the ids v2 completed and prints the outcome", () => {
    const half = answers(null, new Set()).slice(0, 40);
    const text = formatComparison({ items, v1: answers("LOW", lowWrong), v2: half });
    expect(text).toContain("(40 items, the same items for both)");
    expect(text).toMatch(/\*\*Outcome: v2 (is adopted as the default|is NOT adopted; v1 stays the default)\.\*\*/);
    expect(text).toContain("under-rated");
  });
});
