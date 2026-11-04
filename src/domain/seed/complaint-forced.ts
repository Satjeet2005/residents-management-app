import { STAFF_COMMENTS } from "./complaint-text";
import type { ComplaintPlan } from "./complaint-types";
import { type PlanContext, categoryByCode } from "./complaint-plan";
import { assigneeFor } from "./settings";
import type { CalendarDate } from "../time/calendar";
import { dayStartInstant } from "../time/calendar";
import type { DemoFlat, DemoFlatMember, DemoUser } from "./types";

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Flats whose scenarios must stay exactly as written: the random complaints never use them. */
export const FORCED_COMPLAINT_FLATS: readonly string[] = ["T12-0408", "T07-1203", "T15-0902", "T21-1601"];

/** An India Standard Time clock time on `date`, in epoch milliseconds. */
const ist = (date: CalendarDate, hour: number, minute = 0): number => dayStartInstant(date) + hour * HOUR + minute * MINUTE;

const pair = (resident: { flatKey: string; userKey: string }) => ({ flatKey: resident.flatKey, raisedByUserKey: resident.userKey });

type Lookup = { flats: readonly DemoFlat[]; users: readonly DemoUser[]; members: readonly DemoFlatMember[] };

function residentOf(lookup: Lookup, flatCode: string, name: string): { flatKey: string; userKey: string } {
  const flat = lookup.flats.find((f) => f.code === flatCode);
  const user = lookup.users.find((u) => u.name === name);
  if (flat === undefined || user === undefined) throw new RangeError(`Forced resident ${name} of ${flatCode} is missing`);
  return { flatKey: flat.key, userKey: user.key };
}

type Basics = Pick<ComplaintPlan, "id" | "flatKey" | "raisedByUserKey" | "body" | "categoryCode" | "urgency" | "safety" | "createdAt">;

/** A plan with nothing after creation and classification; each scenario adds the steps it needs. */
function bare(ctx: PlanContext, basics: Basics): ComplaintPlan {
  return {
    ...basics,
    assigneeUserKey: assigneeFor(categoryByCode(ctx, basics.categoryCode), basics.safety, ctx.dutyManagerUserKey),
    classification: { source: basics.safety ? "RULE" : "LLM", confidence: basics.safety ? null : 0.9, at: basics.createdAt + MINUTE, correctedFromCategoryCode: null },
    escalatedAt: null,
    assignedAt: null,
    firstResponseAt: null,
    comments: [],
    resolvedAt: null,
    closedAt: null,
    closeKind: null,
    rating: null,
    reopen: null,
    extraEvents: [],
  };
}

/** The demo's fixed complaints. They use no random draws, so they are identical on every seed. */
export function forcedPlans(ctx: PlanContext, lookup: Lookup): ComplaintPlan[] {
  const swati = residentOf(lookup, "T12-0408", "Swati Joshi");
  const neeraj = residentOf(lookup, "T07-1203", "Neeraj Kulkarni");
  const rohit = residentOf(lookup, "T15-0902", "Rohit Deshmukh");
  // Any flat of tower T09 will do. The first one in code order exists for every seed.
  const gasFlat = lookup.flats.find((f) => f.tower === "T09");
  const gasMember = lookup.members.find((m) => m.flatKey === gasFlat?.key);
  if (gasFlat === undefined || gasMember === undefined) throw new RangeError("Tower T09 has no flat with a member");

  const leakAt = ist("2026-10-26", 17);
  const waterLeak: ComplaintPlan = {
    ...bare(ctx, { id: "forced-water-leak", ...pair(swati), body: "Water leak under the kitchen sink", categoryCode: "PLUMBING", urgency: "NORMAL", safety: false, createdAt: leakAt }),
    assignedAt: ist("2026-10-26", 17, 30),
  };

  const lightAt = ist("2026-10-24", 11);
  const corridorLight: ComplaintPlan = {
    ...bare(ctx, { id: "forced-corridor-light", ...pair(neeraj), body: "Corridor light not working", categoryCode: "ELECTRICAL", urgency: "NORMAL", safety: false, createdAt: lightAt }),
    assignedAt: lightAt + 10 * MINUTE,
    firstResponseAt: lightAt + 90 * MINUTE,
    comments: [{ at: lightAt + 3 * HOUR, body: STAFF_COMMENTS[0] }],
    resolvedAt: ist("2026-10-26", 15),
  };

  const garbage: ComplaintPlan = bare(ctx, {
    id: "forced-garbage",
    ...pair(rohit),
    body: "Garbage was not collected from our floor today.",
    categoryCode: "HOUSEKEEPING",
    urgency: "NORMAL",
    safety: false,
    createdAt: ist("2026-10-27", 10),
  });

  const gasAt = ist("2026-10-27", 11);
  const gas: ComplaintPlan = {
    ...bare(ctx, { id: "forced-gas-smell", flatKey: gasFlat.key, raisedByUserKey: gasMember.userKey, body: "Smell of gas in the corridor", categoryCode: "OTHER", urgency: "CRITICAL", safety: true, createdAt: gasAt }),
    escalatedAt: gasAt + MINUTE,
    assignedAt: gasAt + MINUTE,
  };

  return [waterLeak, corridorLight, garbage, gas];
}
