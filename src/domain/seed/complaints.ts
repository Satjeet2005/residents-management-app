import { buildClusters } from "./complaint-clusters";
import { FORCED_COMPLAINT_FLATS, forcedPlans } from "./complaint-forced";
import { materialise } from "./complaint-timeline";
import { SAFETY_CATEGORY, SAFETY_KINDS, complaintBody, safetyBody } from "./complaint-text";
import { type ComplaintSpec, type PlanContext, planComplaint } from "./complaint-plan";
import type { ComplaintPlan, DemoComplaints } from "./complaint-types";
import { allocateQuotas } from "./flats";
import { drawMoment } from "./moments";
import type { Prng } from "./prng";
import { DUTY_MANAGER_NAME, userKeyByName } from "./settings";
import { type ComplaintUrgency, type DemoComplaintCategory, type DemoFlat, type DemoFlatMember, type DemoUser } from "./types";

/** Complaints from 2026-09-01 to DEMO_NOW: about 1,800 a month in September and 1,600 in the 27 days of October. */
export const TOTAL_COMPLAINTS = 3450;
const SAFETY_COMPLAINTS = 30;

/** Category shares in tenths of a percent. */
const CATEGORY_SHARES: readonly (readonly [string, number])[] = [
  ["PLUMBING", 287],
  ["ELECTRICAL", 226],
  ["HOUSEKEEPING", 182],
  ["LIFT", 160],
  ["OTHER", 145],
];
/** Urgency weights for the ordinary complaints (CRITICAL is only for safety). */
const URGENCY_WEIGHTS: readonly (readonly [ComplaintUrgency, number])[] = [
  ["NORMAL", 725],
  ["HIGH", 145],
  ["LOW", 130],
];

const pad4 = (n: number) => String(n).padStart(4, "0");

/** Counts per category code of the complaints that are not random bulk. */
function countCategories(plans: readonly ComplaintPlan[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const plan of plans) counts.set(plan.categoryCode, (counts.get(plan.categoryCode) ?? 0) + 1);
  return counts;
}

export function buildComplaints(
  rng: Prng,
  flats: readonly DemoFlat[],
  users: readonly DemoUser[],
  members: readonly DemoFlatMember[],
  categories: readonly DemoComplaintCategory[],
): DemoComplaints {
  const ctx: PlanContext = { categories, dutyManagerUserKey: userKeyByName(users, DUTY_MANAGER_NAME) };
  const membersOf = new Map<string, string[]>();
  for (const m of members) membersOf.set(m.flatKey, [...(membersOf.get(m.flatKey) ?? []), m.userKey]);
  const firstMemberOf = (flatKey: string) => (membersOf.get(flatKey) as string[])[0];
  const eligible = flats.filter((f) => !FORCED_COMPLAINT_FLATS.includes(f.code));

  const forced = forcedPlans(ctx, { flats, users, members });
  const clusters = buildClusters(rng, ctx, flats, firstMemberOf);

  const safetyPlans = Array.from({ length: SAFETY_COMPLAINTS }, (_, i): ComplaintPlan => {
    const r = rng.fork(`complaint:safety${pad4(i)}`);
    const kind = SAFETY_KINDS[i % SAFETY_KINDS.length];
    const flat = r.pick(eligible);
    const spec: ComplaintSpec = {
      id: `safety${pad4(i)}`,
      flatKey: flat.key,
      raisedByUserKey: r.pick(membersOf.get(flat.key) as string[]),
      body: safetyBody(r, kind),
      categoryCode: SAFETY_CATEGORY[kind],
      urgency: "CRITICAL",
      safety: true,
      createdAt: drawMoment(r, 540),
    };
    return planComplaint(r, ctx, spec);
  });

  const fixed = [...forced, ...clusters.plans, ...safetyPlans];
  const bulkCount = TOTAL_COMPLAINTS - fixed.length;
  const fixedCounts = countCategories(fixed);
  const targets = allocateQuotas(TOTAL_COMPLAINTS, CATEGORY_SHARES.map(([, share]) => share));
  const bulkCategories = CATEGORY_SHARES.flatMap(([code], i) => Array.from({ length: targets[i] - (fixedCounts.get(code) ?? 0) }, () => code));
  const urgencyQuotas = allocateQuotas(bulkCount, URGENCY_WEIGHTS.map(([, weight]) => weight));
  const bulkUrgencies = URGENCY_WEIGHTS.flatMap(([urgency], i) => Array.from({ length: urgencyQuotas[i] }, () => urgency));
  if (bulkCategories.length !== bulkCount) throw new RangeError("Complaint category quotas do not add up to the bulk count");
  const categoryDeck = rng.fork("complaints:categories").shuffle(bulkCategories);
  const urgencyDeck = rng.fork("complaints:urgencies").shuffle(bulkUrgencies);

  const bulkPlans = categoryDeck.map((categoryCode, i): ComplaintPlan => {
    const r = rng.fork(`complaint:bulk${pad4(i)}`);
    const flat = r.pick(eligible);
    const spec: ComplaintSpec = {
      id: `bulk${pad4(i)}`,
      flatKey: flat.key,
      raisedByUserKey: r.pick(membersOf.get(flat.key) as string[]),
      body: complaintBody(r, categoryCode),
      categoryCode,
      urgency: urgencyDeck[i],
      safety: false,
      createdAt: drawMoment(r, 700),
    };
    return planComplaint(r, ctx, spec);
  });

  const rows = [...fixed, ...bulkPlans].map((plan) => materialise(plan, ctx.dutyManagerUserKey));
  rows.sort((a, b) => a.complaint.createdAt - b.complaint.createdAt || (a.complaint.key < b.complaint.key ? -1 : 1));
  return {
    complaints: rows.map((row) => row.complaint),
    events: rows.flatMap((row) => row.events),
    classifications: rows.map((row) => row.classification),
    links: clusters.links,
    affected: clusters.affected,
  };
}
