import type { CloseKind, ComplaintPlan } from "./complaint-types";
import type { Prng } from "./prng";
import { STAFF_COMMENTS } from "./complaint-text";
import { DEMO_NOW, type ComplaintUrgency } from "./types";

const MINUTE = 60_000;
const AUTO_CLOSE_MINUTES = 7 * 1440;
/** Longest wait from creation to "resolved", so a complaint older than 10 days is always finished. */
const MAX_RESOLUTION_MINUTES = 4320;
/** The same limit when the complaint is reopened later, so both trips still fit inside 10 days. */
const MAX_RESOLUTION_BEFORE_REOPEN_MINUTES = 3000;
/** Share of first responses that miss their SLA (not LOW, whose SLA is longer than a resolution may take). */
const SLA_BREACH_SHARE = 0.16;
const REOPEN_SHARE = 0.11;
const AUTO_CLOSE_SHARE = 0.28;
const COMMENT_SHARE = 0.4;

type Range = readonly [number, number];
type Bucket = { value: Range; weight: number };

const inBucket = (r: Prng, buckets: readonly Bucket[]): number => {
  const [low, high] = r.weighted(buckets);
  return r.int(low, high);
};

const NORMAL_RESPONSE: readonly Bucket[] = [
  { value: [15, 60], weight: 42 },
  { value: [61, 120], weight: 28 },
  { value: [121, 360], weight: 18 },
  { value: [361, 1440], weight: 12 },
];
const HIGH_RESPONSE: readonly Bucket[] = [
  { value: [10, 45], weight: 50 },
  { value: [46, 90], weight: 35 },
  { value: [91, 120], weight: 15 },
];
const LOW_RESPONSE: readonly Bucket[] = [
  { value: [20, 120], weight: 30 },
  { value: [121, 720], weight: 40 },
  { value: [721, 2880], weight: 30 },
];
const ASSIGN_DELAY: readonly Bucket[] = [
  { value: [4, 30], weight: 70 },
  { value: [31, 240], weight: 25 },
  { value: [241, 1440], weight: 5 },
];
const WORK: readonly Bucket[] = [
  { value: [30, 240], weight: 10 },
  { value: [241, 1440], weight: 30 },
  { value: [1441, 3600], weight: 60 },
];
const CONFIRM_DELAY: readonly Bucket[] = [
  { value: [120, 1440], weight: 20 },
  { value: [1441, 4320], weight: 80 },
];
const RATINGS = [
  { value: 5, weight: 40 },
  { value: 4, weight: 35 },
  { value: 3, weight: 12 },
  { value: 2, weight: 7 },
  { value: 1, weight: 6 },
];

/** Minutes from creation to the first staff response. */
function responseMinutes(r: Prng, urgency: ComplaintUrgency): number {
  if (urgency === "LOW") return inBucket(r, LOW_RESPONSE);
  const breached = r.chance(SLA_BREACH_SHARE);
  if (urgency === "HIGH") return breached ? r.int(121, 360) : inBucket(r, HIGH_RESPONSE);
  return breached ? r.int(1441, 2100) : inBucket(r, NORMAL_RESPONSE);
}

/** Keeps each time up to the first one that is after DEMO_NOW; later steps have not happened yet. */
function upToNow(times: readonly number[]): (number | null)[] {
  let passed = false;
  return times.map((t) => {
    passed = passed || t > DEMO_NOW;
    return passed ? null : t;
  });
}

type Timeline = Pick<
  ComplaintPlan,
  "escalatedAt" | "assignedAt" | "firstResponseAt" | "comments" | "resolvedAt" | "closedAt" | "closeKind" | "rating" | "reopen"
>;

/** A safety complaint: escalated at once, answered by the duty manager, closed by the duty manager. */
function safetyTimeline(r: Prng, createdAt: number): Timeline {
  const answered = createdAt + (r.chance(0.12) ? r.int(16, 40) : r.int(2, 14)) * MINUTE;
  const closed = answered + r.int(10, 240) * MINUTE;
  const [assignedAt, firstResponseAt, closedAt] = upToNow([createdAt + MINUTE, answered, closed]);
  return {
    escalatedAt: createdAt + MINUTE,
    assignedAt,
    firstResponseAt,
    comments: [],
    resolvedAt: null,
    closedAt,
    closeKind: closedAt === null ? null : "DUTY_MANAGER",
    rating: null,
    reopen: null,
  };
}

/** Draws every step of an ordinary complaint, then drops the steps that fall after DEMO_NOW. */
export function drawTimeline(r: Prng, createdAt: number, urgency: ComplaintUrgency, safety: boolean): Timeline {
  if (safety) return safetyTimeline(r, createdAt);
  const willReopen = r.chance(REOPEN_SHARE);
  const response = responseMinutes(r, urgency);
  const assign = Math.min(inBucket(r, ASSIGN_DELAY), response - 1);
  const cap = willReopen ? MAX_RESOLUTION_BEFORE_REOPEN_MINUTES : MAX_RESOLUTION_MINUTES;
  const resolved = Math.max(response + 30, Math.min(response + inBucket(r, WORK), cap));
  const closeKind: CloseKind = !willReopen && r.chance(AUTO_CLOSE_SHARE) ? "AUTO_CLOSED" : "CONFIRMED";
  const closed = resolved + (closeKind === "AUTO_CLOSED" ? AUTO_CLOSE_MINUTES : willReopen ? r.int(120, 1440) : inBucket(r, CONFIRM_DELAY));
  const rating = closeKind === "CONFIRMED" ? r.weighted(RATINGS) : null;

  const at = (minutes: number) => createdAt + minutes * MINUTE;
  const reopenAt = at(closed) + r.int(120, 2880) * MINUTE;
  const resolvedAgain = reopenAt + r.int(60, 2880) * MINUTE;
  const closedAgain = resolvedAgain + r.int(120, 1440) * MINUTE;
  const ratingAgain = r.weighted(RATINGS);

  const [assignedAt, firstResponseAt, resolvedAt, closedAt, reopenedAt, resolvedAgainAt, closedAgainAt] = upToNow([
    at(assign),
    at(response),
    at(resolved),
    at(closed),
    ...(willReopen ? [reopenAt, resolvedAgain, closedAgain] : []),
  ]);

  const commentAt = firstResponseAt === null ? null : firstResponseAt + r.int(5, 60) * MINUTE;
  const commentLimit = Math.min(DEMO_NOW, resolvedAt ?? Infinity);
  const wantsComment = r.chance(COMMENT_SHARE);
  const comment = r.pick(STAFF_COMMENTS);
  const comments = wantsComment && commentAt !== null && commentAt <= commentLimit ? [{ at: commentAt, body: comment }] : [];

  return {
    escalatedAt: null,
    assignedAt,
    firstResponseAt,
    comments,
    resolvedAt,
    closedAt,
    closeKind: closedAt === null ? null : closeKind,
    rating: closedAt === null ? null : rating,
    reopen: reopenedAt === null || reopenedAt === undefined ? null : { at: reopenedAt, resolvedAt: resolvedAgainAt ?? null, closedAt: closedAgainAt ?? null, rating: closedAgainAt == null ? null : ratingAgain },
  };
}
