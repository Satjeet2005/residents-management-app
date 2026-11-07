import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "@/server/complaints/providers/breaker";
import { DailyCap } from "@/server/complaints/providers/cap";

function setup(failures = 3, cooldownMs = 120_000) {
  const time = { now: 1_000_000 };
  return { time, breaker: new CircuitBreaker({ failures, cooldownMs, now: () => time.now }) };
}

describe("PV5 circuit breaker", () => {
  it("stays closed below the failure count and a success resets the run", () => {
    const { breaker } = setup();
    breaker.failure();
    breaker.failure();
    breaker.success();
    breaker.failure();
    breaker.failure();
    expect(breaker.allow()).toBe(true);
  });

  it("opens after N failures in a row, and the Nth failure says so", () => {
    const { breaker } = setup();
    expect([breaker.failure(), breaker.failure(), breaker.failure()]).toEqual([false, false, true]);
    expect(breaker.allow()).toBe(false);
  });

  it("skips the provider for the whole cooldown, then lets ONE trial through", () => {
    const { breaker, time } = setup();
    for (let i = 0; i < 3; i += 1) breaker.failure();
    time.now += 119_999;
    expect(breaker.allow()).toBe(false);
    time.now += 1;
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false);
    expect(breaker.allow()).toBe(false);
  });

  it("a successful trial closes it", () => {
    const { breaker, time } = setup();
    for (let i = 0; i < 3; i += 1) breaker.failure();
    time.now += 120_000;
    breaker.allow();
    breaker.success();
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(true);
    breaker.failure();
    breaker.failure();
    expect(breaker.allow()).toBe(true);
  });

  it("a failed trial opens it again for a FULL cooldown", () => {
    const { breaker, time } = setup();
    for (let i = 0; i < 3; i += 1) breaker.failure();
    time.now += 120_000;
    breaker.allow();
    expect(breaker.failure()).toBe(true);
    time.now += 119_999;
    expect(breaker.allow()).toBe(false);
    time.now += 1;
    expect(breaker.allow()).toBe(true);
  });

  it("trip opens at once, for the time given or the cooldown, and says whether it was closed before", () => {
    const { breaker, time } = setup();
    expect(breaker.trip(5_000)).toBe(true);
    expect(breaker.allow()).toBe(false);
    time.now += 5_000;
    expect(breaker.allow()).toBe(true);
    expect(breaker.trip()).toBe(false);
    time.now += 119_999;
    expect(breaker.allow()).toBe(false);
  });

  it("one failure opens a breaker set to 1", () => {
    const { breaker } = setup(1);
    expect(breaker.failure()).toBe(true);
    expect(breaker.allow()).toBe(false);
  });
});

describe("PV6 daily cap", () => {
  const istMidnight = Date.UTC(2026, 10, 6, 18, 30, 0);

  it("stops at the limit", () => {
    const cap = new DailyCap(3, () => istMidnight - 3_600_000);
    for (let i = 0; i < 3; i += 1) {
      expect(cap.hasRoom()).toBe(true);
      cap.take();
    }
    expect(cap.hasRoom()).toBe(false);
  });

  it("starts again at midnight India time, not at midnight UTC", () => {
    const time = { now: Date.UTC(2026, 10, 5, 23, 59, 0) };
    const cap = new DailyCap(2, () => time.now);
    cap.take();
    cap.take();
    expect(cap.hasRoom()).toBe(false);
    time.now = Date.UTC(2026, 10, 6, 0, 1, 0);
    expect(cap.hasRoom()).toBe(false);
    time.now = istMidnight - 1;
    expect(cap.hasRoom()).toBe(false);
    time.now = istMidnight;
    expect(cap.hasRoom()).toBe(true);
    cap.take();
    expect(cap.hasRoom()).toBe(true);
    cap.take();
    expect(cap.hasRoom()).toBe(false);
  });

  it("a cap of 1 allows exactly one call a day", () => {
    const cap = new DailyCap(1, () => istMidnight);
    expect(cap.hasRoom()).toBe(true);
    cap.take();
    expect(cap.hasRoom()).toBe(false);
  });
});
