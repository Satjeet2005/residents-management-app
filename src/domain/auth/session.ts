import type { Role, SessionPolicy } from "./policy";

/** When a session that starts at `now` must end whatever the person does, in epoch milliseconds. */
export function newSessionExpiry(role: Role, now: number, policy: SessionPolicy): number {
  return now + policy.session[role].absoluteSeconds * 1000;
}

export type SessionInvalidReason = "REVOKED" | "USER_INACTIVE" | "EXPIRED_IDLE" | "EXPIRED_ABSOLUTE";
export type SessionDecision = { valid: true; shouldTouch: boolean } | { valid: false; reason: SessionInvalidReason };

/**
 * Is a stored session still good at `now`? Checks in this order: USER_INACTIVE, REVOKED,
 * EXPIRED_ABSOLUTE (at exactly `absoluteExpiresAt` it has ended), EXPIRED_IDLE (the time since
 * `lastSeenAt` has reached the idle limit), else valid. `shouldTouch` says the caller should write
 * a new `lastSeenAt`; it is true only once the throttle has passed, so a busy page does not write
 * on every request. A `lastSeenAt` later than `now` (clock skew) counts as just seen.
 * `createdAt` is part of the stored record but the end is `absoluteExpiresAt`, set by newSessionExpiry.
 */
export function evaluateSession(
  input: {
    role: Role;
    createdAt: number;
    lastSeenAt: number;
    absoluteExpiresAt: number;
    revokedAt: number | null;
    userActive: boolean;
  },
  now: number,
  policy: SessionPolicy,
): SessionDecision {
  if (!input.userActive) return { valid: false, reason: "USER_INACTIVE" };
  if (input.revokedAt !== null) return { valid: false, reason: "REVOKED" };
  if (now >= input.absoluteExpiresAt) return { valid: false, reason: "EXPIRED_ABSOLUTE" };
  const sinceSeen = Math.max(0, now - input.lastSeenAt);
  if (sinceSeen >= policy.session[input.role].idleSeconds * 1000) return { valid: false, reason: "EXPIRED_IDLE" };
  return { valid: true, shouldTouch: sinceSeen >= policy.touchThrottleSeconds * 1000 };
}
