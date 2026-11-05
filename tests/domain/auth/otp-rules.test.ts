import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGE_KEYS, authMessageKey, evaluateOtpAttempt, evaluateOtpRequest, type AuthOutcome } from "@/domain/auth/otp";
import { authPolicy } from "@/domain/auth/policy";

const policy = authPolicy.otp;
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const request = (phoneRequestTimes: number[], ipRequestTimes: number[] = [], now = NOW) =>
  evaluateOtpRequest({ now, phoneRequestTimes, ipRequestTimes }, policy);
/** n requests spread one minute apart, newest first at `newest` ms ago. */
const spread = (n: number, newestAgo: number) => Array.from({ length: n }, (_, i) => NOW - newestAgo - i * 60_000);

describe("AU3 policy values", () => {
  it("are the confirmed defaults", () => {
    expect(policy).toEqual({ digits: 6, ttlSeconds: 300, maxAttempts: 5, resendCooldownSeconds: 30, maxRequestsPerPhonePerHour: 5, maxRequestsPerIpPerHour: 30 });
  });
});

describe("AU3 evaluateOtpRequest", () => {
  it("allows a first request", () => {
    expect(request([])).toEqual({ allowed: true });
  });

  it.each([
    [0, 30],
    [1, 30],
    [1_000, 29],
    [29_000, 1],
    [29_001, 1],
    [29_500, 1],
    [29_999, 1],
  ])("refuses with COOLDOWN when the last request was %i ms ago (retry in %i s)", (ago, seconds) => {
    expect(request([NOW - ago])).toEqual({ allowed: false, reason: "COOLDOWN", retryAfterSeconds: seconds });
  });

  it("allows exactly at the cooldown (30,000 ms) and not at 29,999 ms", () => {
    expect(request([NOW - 30_000])).toEqual({ allowed: true });
    expect(request([NOW - 29_999]).allowed).toBe(false);
  });

  it("uses the newest request for the cooldown, whatever the order", () => {
    expect(request([NOW - 40_000, NOW - 5_000, NOW - 90_000])).toMatchObject({ reason: "COOLDOWN", retryAfterSeconds: 25 });
  });

  it("allows 4 requests in the hour and refuses the 6th at the limit of 5", () => {
    expect(request(spread(4, 60_000))).toEqual({ allowed: true });
    expect(request(spread(5, 60_000))).toMatchObject({ allowed: false, reason: "PHONE_LIMIT" });
    expect(request(spread(6, 60_000))).toMatchObject({ allowed: false, reason: "PHONE_LIMIT" });
  });

  it("gives the seconds until the oldest request in the window leaves it, rounded up", () => {
    const times = [NOW - 3_000_000, NOW - 2_000_000, NOW - 1_000_000, NOW - 500_000, NOW - 100_000];
    expect(request(times)).toEqual({ allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: 600 });
    const odd = [NOW - 3_599_001, NOW - 2_000_000, NOW - 1_000_000, NOW - 500_000, NOW - 100_000];
    expect(request(odd)).toEqual({ allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: 1 });
    const part = [NOW - 3_000_500, NOW - 2_000_000, NOW - 1_000_000, NOW - 500_000, NOW - 100_000];
    expect(request(part)).toEqual({ allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: 600 });
  });

  it("a request exactly one hour old is out of the window; one a millisecond younger is in", () => {
    const old = [NOW - HOUR, NOW - 2_000_000, NOW - 1_000_000, NOW - 500_000, NOW - 100_000];
    expect(request(old)).toEqual({ allowed: true });
    const young = [NOW - HOUR + 1, ...old.slice(1)];
    expect(request(young)).toEqual({ allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: 1 });
  });

  it("waits for as many requests to leave as it takes to get below the limit", () => {
    const seven = [NOW - 3_000_000, NOW - 2_900_000, NOW - 2_800_000, NOW - 1_000_000, NOW - 900_000, NOW - 800_000, NOW - 100_000];
    expect(request(seven)).toEqual({ allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: 800 });
  });

  it("limits an address at 30 an hour and allows 29", () => {
    const ips = (n: number) => Array.from({ length: n }, (_, i) => NOW - 60_000 - i * 1_000);
    expect(request([], ips(29))).toEqual({ allowed: true });
    expect(request([], ips(30))).toEqual({ allowed: false, reason: "IP_LIMIT", retryAfterSeconds: 3_511 });
  });

  it("checks COOLDOWN before PHONE_LIMIT before IP_LIMIT", () => {
    const ips = Array.from({ length: 30 }, (_, i) => NOW - 60_000 - i);
    expect(request([NOW - 1_000, ...spread(5, 60_000)], ips)).toMatchObject({ reason: "COOLDOWN" });
    expect(request(spread(5, 60_000), ips)).toMatchObject({ reason: "PHONE_LIMIT" });
    expect(request([], ips)).toMatchObject({ reason: "IP_LIMIT" });
  });

  it("ignores times in the future", () => {
    expect(request([NOW + 1, NOW + 10_000])).toEqual({ allowed: true });
    expect(request([...spread(4, 60_000), NOW + 1_000])).toEqual({ allowed: true });
    expect(request([], Array.from({ length: 40 }, (_, i) => NOW + 1 + i))).toEqual({ allowed: true });
  });

  it("counts a request at this very millisecond", () => {
    expect(request([NOW])).toMatchObject({ reason: "COOLDOWN", retryAfterSeconds: 30 });
  });
});

describe("AU4 evaluateOtpAttempt", () => {
  const base: { now: number; expiresAt: number; attempts: number; consumedAt: number | null; codeMatches: boolean } = { now: NOW, expiresAt: NOW + 1, attempts: 0, consumedAt: null, codeMatches: true };
  const attempt = (change: Partial<typeof base>) => evaluateOtpAttempt({ ...base, ...change }, policy);

  it("accepts a right code in time", () => {
    expect(attempt({})).toEqual({ outcome: "OK", attemptsLeft: 5 });
    expect(attempt({ attempts: 4 })).toEqual({ outcome: "OK", attemptsLeft: 1 });
  });

  it("answers WRONG for a wrong code, with the attempts that remain after it", () => {
    expect(attempt({ codeMatches: false })).toEqual({ outcome: "WRONG", attemptsLeft: 4 });
  });

  it("a full run of five wrong attempts counts 4, 3, 2, 1, 0 and then locks", () => {
    const left: number[] = [];
    let attempts = 0;
    for (let i = 0; i < 5; i++) {
      const result = attempt({ attempts, codeMatches: false });
      expect(result.outcome).toBe("WRONG");
      left.push(result.attemptsLeft);
      attempts += 1;
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(attempt({ attempts, codeMatches: false })).toEqual({ outcome: "LOCKED", attemptsLeft: 0 });
  });

  it("is LOCKED even when the code is right", () => {
    expect(attempt({ attempts: 5, codeMatches: true })).toEqual({ outcome: "LOCKED", attemptsLeft: 0 });
    expect(attempt({ attempts: 9, codeMatches: true }).outcome).toBe("LOCKED");
  });

  it("expires at exactly expiresAt, and not one millisecond before", () => {
    expect(attempt({ expiresAt: NOW }).outcome).toBe("EXPIRED");
    expect(attempt({ expiresAt: NOW - 1 }).outcome).toBe("EXPIRED");
    expect(attempt({ expiresAt: NOW + 1 }).outcome).toBe("OK");
  });

  it("a consumed code beats every other outcome", () => {
    expect(attempt({ consumedAt: NOW - 10, expiresAt: NOW - 5, attempts: 9, codeMatches: true }).outcome).toBe("CONSUMED");
    expect(attempt({ consumedAt: NOW - 10, codeMatches: false }).outcome).toBe("CONSUMED");
    expect(attempt({ consumedAt: 0 }).outcome).toBe("CONSUMED");
  });

  it("expired beats locked and wrong", () => {
    expect(attempt({ expiresAt: NOW, attempts: 9, codeMatches: false }).outcome).toBe("EXPIRED");
    expect(attempt({ expiresAt: NOW, codeMatches: false }).outcome).toBe("EXPIRED");
  });

  it("locked beats wrong", () => {
    expect(attempt({ attempts: 5, codeMatches: false }).outcome).toBe("LOCKED");
  });
});

describe("AU4 authMessageKey", () => {
  const expected: [AuthOutcome, string][] = [
    ["SENT", "OTP_SENT_GENERIC"],
    ["WRONG", "OTP_NOT_ACCEPTED"],
    ["EXPIRED", "OTP_NOT_ACCEPTED"],
    ["CONSUMED", "OTP_NOT_ACCEPTED"],
    ["LOCKED", "OTP_LOCKED"],
    ["COOLDOWN", "TOO_MANY_REQUESTS"],
    ["PHONE_LIMIT", "TOO_MANY_REQUESTS"],
    ["IP_LIMIT", "TOO_MANY_REQUESTS"],
  ];

  it.each(expected)("%s gives %s", (outcome, key) => {
    expect(authMessageKey(outcome)).toBe(key);
  });

  it("uses only four keys", () => {
    expect(Object.values(CLIENT_MESSAGE_KEYS).sort()).toEqual(["OTP_LOCKED", "OTP_NOT_ACCEPTED", "OTP_SENT_GENERIC", "TOO_MANY_REQUESTS"]);
    expect(new Set(expected.map(([o]) => authMessageKey(o))).size).toBe(4);
  });
});
