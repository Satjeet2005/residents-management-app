import { type ComplaintSpec, type PlanContext, planComplaint } from "./complaint-plan";
import type { ComplaintPlan, DemoAffected, DemoComplaintLink } from "./complaint-types";
import { FORCED_COMPLAINT_FLATS } from "./complaint-forced";
import type { Prng } from "./prng";
import { type ComplaintUrgency, type DemoFlat, WINDOW_START } from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;

type ClusterSpec = { size: number; tower: string; categoryCode: string; urgency: ComplaintUrgency; bodies: readonly string[] };

/** Six incidents: one tower, one day, one category. The first is a lift outage that hit 12 flats of T07. */
const CLUSTERS: readonly ClusterSpec[] = [
  { size: 12, tower: "T07", categoryCode: "LIFT", urgency: "HIGH", bodies: ["The lift is not working in our tower.", "Both lifts of our tower are down, please repair urgently.", "No lift since morning, elderly residents cannot come down.", "Lift out of service in our tower, please check."] },
  { size: 9, tower: "T14", categoryCode: "PLUMBING", urgency: "NORMAL", bodies: ["There is no water supply in our tower since morning.", "Water is not coming in the taps on our floor.", "No water in the flat, the neighbours have the same problem."] },
  { size: 7, tower: "T22", categoryCode: "ELECTRICAL", urgency: "HIGH", bodies: ["There is a power cut in the whole tower.", "No electricity in our flat, the neighbours also have no power.", "The common area power is off in our tower."] },
  { size: 6, tower: "T03", categoryCode: "HOUSEKEEPING", urgency: "NORMAL", bodies: ["Garbage was not collected from our tower today.", "The garbage chute area of our tower is overflowing.", "Nobody has cleaned the lobby of our tower today."] },
  { size: 5, tower: "T25", categoryCode: "OTHER", urgency: "NORMAL", bodies: ["The intercom of our tower is not working.", "Cannot call the gate from the intercom in our flat.", "Intercom is dead in the whole tower."] },
  { size: 4, tower: "T11", categoryCode: "PLUMBING", urgency: "NORMAL", bodies: ["Drain water is overflowing near the tower entrance.", "Sewage is overflowing in the basement of our tower."] },
];

/** The incidents where other flats also said "I'm affected too". */
const CLUSTERS_WITH_AFFECTED = new Set([0, 1, 3]);

export type Clusters = { plans: ComplaintPlan[]; links: DemoComplaintLink[]; affected: DemoAffected[] };

export function buildClusters(
  rng: Prng,
  ctx: PlanContext,
  flats: readonly DemoFlat[],
  firstMemberOf: (flatKey: string) => string,
): Clusters {
  const plans: ComplaintPlan[] = [];
  const links: DemoComplaintLink[] = [];
  const affected: DemoAffected[] = [];

  CLUSTERS.forEach((cluster, k) => {
    const r = rng.fork(`cluster:${k}`);
    const towerFlats = r.fork("flats").shuffle(flats.filter((f) => f.tower === cluster.tower && !FORCED_COMPLAINT_FLATS.includes(f.code)));
    const startOfDay = WINDOW_START + r.int(5, 50) * DAY + r.int(420, 840) * MINUTE;
    const gaps = Array.from({ length: cluster.size - 1 }, () => r.int(3, 180)).sort((a, b) => a - b);
    const offsets = [0, ...gaps];

    const clusterPlans = offsets.map((offset, j) => {
      const flat = towerFlats[j];
      const spec: ComplaintSpec = {
        id: `cluster${k}-${String(j + 1).padStart(2, "0")}`,
        flatKey: flat.key,
        raisedByUserKey: firstMemberOf(flat.key),
        body: r.pick(cluster.bodies),
        categoryCode: cluster.categoryCode,
        urgency: cluster.urgency,
        safety: false,
        createdAt: startOfDay + offset * MINUTE,
      };
      return planComplaint(r.fork(`complaint:${j}`), ctx, spec);
    });

    const primary = clusterPlans[0];
    const primaryKey = `complaint:${primary.id}`;
    for (const duplicate of clusterPlans.slice(1)) {
      const linkedAt = duplicate.createdAt + 2 * MINUTE;
      links.push({ primaryKey, duplicateKey: `complaint:${duplicate.id}`, similarity: r.int(800, 980) / 1000, linkedByUserKey: null, createdAt: linkedAt });
      duplicate.extraEvents.push({ type: "DUPLICATE_LINKED", at: linkedAt, payload: { primary: primaryKey } });
    }

    if (CLUSTERS_WITH_AFFECTED.has(k)) {
      const count = r.int(3, 8);
      for (const flat of towerFlats.slice(cluster.size, cluster.size + count)) {
        const at = primary.createdAt + r.int(10, 120) * MINUTE;
        affected.push({ complaintKey: primaryKey, flatKey: flat.key, createdAt: at });
        primary.extraEvents.push({ type: "AFFECTED_TOO", at, payload: { flat: flat.key } });
      }
    }
    plans.push(...clusterPlans);
  });

  return { plans, links, affected };
}
