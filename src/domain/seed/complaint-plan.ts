import { drawTimeline } from "./complaint-lifecycle";
import type { ClassificationSource, ComplaintPlan } from "./complaint-types";
import type { Prng } from "./prng";
import { assigneeFor } from "./settings";
import { DEMO_NOW, type ComplaintUrgency, type DemoComplaintCategory } from "./types";

const MINUTE = 60_000;

export type PlanContext = { categories: readonly DemoComplaintCategory[]; dutyManagerUserKey: string };

export type ComplaintSpec = {
  id: string;
  flatKey: string;
  raisedByUserKey: string;
  body: string;
  categoryCode: string;
  urgency: ComplaintUrgency;
  safety: boolean;
  createdAt: number;
};

const SOURCES: readonly { value: ClassificationSource; weight: number }[] = [
  { value: "LLM", weight: 85 },
  { value: "FALLBACK", weight: 10 },
  { value: "MANUAL", weight: 5 },
];

export function categoryByCode(ctx: PlanContext, code: string): DemoComplaintCategory {
  const category = ctx.categories.find((c) => c.code === code);
  if (category === undefined) throw new RangeError(`Unknown complaint category ${code}`);
  return category;
}

function drawClassification(r: Prng, ctx: PlanContext, spec: ComplaintSpec, assignedAt: number | null): ComplaintPlan["classification"] {
  if (spec.safety) return { source: "RULE", confidence: null, at: spec.createdAt + MINUTE, correctedFromCategoryCode: null };
  const source = r.weighted(SOURCES);
  const correctedAt = assignedAt === null ? null : assignedAt + r.int(1, 20) * MINUTE;
  if (source === "MANUAL" && correctedAt !== null && correctedAt <= DEMO_NOW) {
    const others = ctx.categories.filter((c) => c.code !== spec.categoryCode);
    return { source, confidence: null, at: correctedAt, correctedFromCategoryCode: r.pick(others).code };
  }
  const at = spec.createdAt + r.int(1, 3) * MINUTE;
  return { source: source === "MANUAL" ? "LLM" : source, confidence: r.int(600, 980) / 1000, at, correctedFromCategoryCode: null };
}

/** A complaint with a random life, from its fixed facts. All randomness comes from `r`. */
export function planComplaint(r: Prng, ctx: PlanContext, spec: ComplaintSpec): ComplaintPlan {
  const timeline = drawTimeline(r, spec.createdAt, spec.urgency, spec.safety);
  return {
    ...spec,
    assigneeUserKey: assigneeFor(categoryByCode(ctx, spec.categoryCode), spec.safety, ctx.dutyManagerUserKey),
    classification: drawClassification(r, ctx, spec, timeline.assignedAt),
    extraEvents: [],
    ...timeline,
  };
}
