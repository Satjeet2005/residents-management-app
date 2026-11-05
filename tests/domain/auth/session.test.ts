import { describe, expect, it } from "vitest";
import { authPolicy, type Role } from "@/domain/auth/policy";
import { evaluateSession, newSessionExpiry } from "@/domain/auth/session";

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const record = (role: Role, change: Partial<{ createdAt: number; lastSeenAt: number; absoluteExpiresAt: number; revokedAt: number | null; userActive: boolean }> = {}) => ({
  role,
  createdAt: NOW,
  lastSeenAt: NOW,
  absoluteExpiresAt: newSessionExpiry(role, NOW, authPolicy),
  revokedAt: null,
  userActive: true,
  ...change,
});
const at = (role: Role, now: number, change: Parameters<typeof record>[1] = {}) => evaluateSession(record(role, change), now, authPolicy);

describe("AU5 session policy values", () => {
  it("a staff session is 30 minutes idle and 12 hours overall; a resident's is 14 days idle and 30 days overall", () => {
    expect(authPolicy.session.STAFF).toEqual({ idleSeconds: 30 * 60, absoluteSeconds: 12 * 3600 });
    expect(authPolicy.session.STAFF).toEqual({ idleSeconds: 1800, absoluteSeconds: 43200 });
    expect(authPolicy.session.RESIDENT).toEqual({ idleSeconds: 14 * 86400, absoluteSeconds: 30 * 86400 });
    expect(authPolicy.session.RESIDENT.idleSeconds).toBeGreaterThan(authPolicy.session.STAFF.absoluteSeconds);
    expect(authPolicy.touchThrottleSeconds).toBe(60);
  });
});

describe("AU5 newSessionExpiry", () => {
  it("adds the absolute limit of the role", () => {
    expect(newSessionExpiry("STAFF", NOW, authPolicy)).toBe(NOW + 12 * HOUR);
    expect(newSessionExpiry("RESIDENT", NOW, authPolicy)).toBe(NOW + 30 * DAY);
  });
});

describe("AU5 evaluateSession boundaries", () => {
  it("staff: idle at exactly 30 minutes, one millisecond either side", () => {
    expect(at("STAFF", NOW + 30 * MINUTE - 1)).toMatchObject({ valid: true });
    expect(at("STAFF", NOW + 30 * MINUTE)).toEqual({ valid: false, reason: "EXPIRED_IDLE" });
    expect(at("STAFF", NOW + 30 * MINUTE + 1)).toEqual({ valid: false, reason: "EXPIRED_IDLE" });
  });

  it("staff: absolute at exactly 12 hours, one millisecond either side, when kept active", () => {
    const kept = { lastSeenAt: NOW + 12 * HOUR - 1 };
    expect(at("STAFF", NOW + 12 * HOUR - 1, kept)).toMatchObject({ valid: true });
    expect(at("STAFF", NOW + 12 * HOUR, { lastSeenAt: NOW + 12 * HOUR - 1 })).toEqual({ valid: false, reason: "EXPIRED_ABSOLUTE" });
    expect(at("STAFF", NOW + 12 * HOUR + 1, { lastSeenAt: NOW + 12 * HOUR })).toEqual({ valid: false, reason: "EXPIRED_ABSOLUTE" });
  });

  it("resident: idle at exactly 14 days, one millisecond either side", () => {
    expect(at("RESIDENT", NOW + 14 * DAY - 1)).toMatchObject({ valid: true });
    expect(at("RESIDENT", NOW + 14 * DAY)).toEqual({ valid: false, reason: "EXPIRED_IDLE" });
    expect(at("RESIDENT", NOW + 14 * DAY + 1)).toEqual({ valid: false, reason: "EXPIRED_IDLE" });
  });

  it("resident: absolute at exactly 30 days, one millisecond either side, when kept active", () => {
    expect(at("RESIDENT", NOW + 30 * DAY - 1, { lastSeenAt: NOW + 30 * DAY - 2 })).toMatchObject({ valid: true });
    expect(at("RESIDENT", NOW + 30 * DAY, { lastSeenAt: NOW + 30 * DAY - 1 })).toEqual({ valid: false, reason: "EXPIRED_ABSOLUTE" });
    expect(at("RESIDENT", NOW + 30 * DAY + 1, { lastSeenAt: NOW + 30 * DAY })).toEqual({ valid: false, reason: "EXPIRED_ABSOLUTE" });
  });

  it("a resident is still signed in after a time that has long ended a staff session", () => {
    expect(at("STAFF", NOW + 13 * HOUR, { lastSeenAt: NOW + 13 * HOUR - 1, absoluteExpiresAt: NOW + 12 * HOUR }).valid).toBe(false);
    expect(at("RESIDENT", NOW + 13 * HOUR).valid).toBe(true);
  });
});

describe("AU5 evaluateSession reasons and order", () => {
  it("is invalid when revoked", () => {
    expect(at("STAFF", NOW + 1, { revokedAt: NOW })).toEqual({ valid: false, reason: "REVOKED" });
    expect(at("RESIDENT", NOW + 1, { revokedAt: 0 })).toEqual({ valid: false, reason: "REVOKED" });
  });

  it("is invalid when the user is inactive", () => {
    expect(at("STAFF", NOW + 1, { userActive: false })).toEqual({ valid: false, reason: "USER_INACTIVE" });
    expect(at("RESIDENT", NOW + 1, { userActive: false })).toEqual({ valid: false, reason: "USER_INACTIVE" });
  });

  it("reports USER_INACTIVE before REVOKED before EXPIRED_ABSOLUTE before EXPIRED_IDLE", () => {
    const everything = { userActive: false, revokedAt: NOW, absoluteExpiresAt: NOW + 1 };
    expect(at("STAFF", NOW + 12 * HOUR, everything)).toEqual({ valid: false, reason: "USER_INACTIVE" });
    expect(at("STAFF", NOW + 12 * HOUR, { revokedAt: NOW })).toEqual({ valid: false, reason: "REVOKED" });
    expect(at("STAFF", NOW + 12 * HOUR)).toEqual({ valid: false, reason: "EXPIRED_ABSOLUTE" });
    expect(at("STAFF", NOW + 31 * MINUTE)).toEqual({ valid: false, reason: "EXPIRED_IDLE" });
  });
});

describe("AU5 shouldTouch", () => {
  it.each([
    [0, false],
    [1, false],
    [59_999, false],
    [60_000, true],
    [60_001, true],
    [10 * MINUTE, true],
  ])("%i ms since last seen: shouldTouch %s", (since, touch) => {
    expect(at("STAFF", NOW + since)).toEqual({ valid: true, shouldTouch: touch });
    expect(at("RESIDENT", NOW + since)).toEqual({ valid: true, shouldTouch: touch });
  });

  it("a last-seen time after now (clock skew) is treated as just seen", () => {
    expect(at("STAFF", NOW, { lastSeenAt: NOW + 5 * MINUTE })).toEqual({ valid: true, shouldTouch: false });
  });
});
