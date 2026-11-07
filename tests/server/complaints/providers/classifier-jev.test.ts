import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CircuitBreaker } from "@/server/complaints/providers/breaker";
import { DailyCap } from "@/server/complaints/providers/cap";
import { JevClassifier, type ProviderLogFields } from "@/server/complaints/providers/classifier-jev";
import { JevClient } from "@/server/complaints/providers/client";
import { answerBody, FakeProvider, hang, respondJson } from "./fake-provider";

const primary = new FakeProvider();
const secondary = new FakeProvider();
const INPUT = { text: "the tap under the sink is leaking", arm: "DIRECT" } as const;
const time = { now: Date.UTC(2026, 11, 1, 6, 30) };
let logs: ProviderLogFields[] = [];

function build(options: { timeoutMs?: number; failures?: number; cap?: number; only?: "primary" | "secondary" } = {}): JevClassifier {
  const { timeoutMs = 400, failures = 3, cap = 1000 } = options;
  const slot = (name: "opencode" | "jevmodel", fake: FakeProvider) => ({
    client: new JevClient({ name, url: fake.url, model: "m", key: "test-key-not-a-secret-123" }),
    breaker: new CircuitBreaker({ failures, cooldownMs: 120_000, now: () => time.now }),
    cap: new DailyCap(cap, () => time.now),
  });
  const slots = [slot("opencode", primary), slot("jevmodel", secondary)].filter((_, i) => options.only === undefined || (options.only === "primary" ? i === 0 : i === 1));
  return new JevClassifier(slots, { timeoutMs, cooldownMs: 120_000, log: (fields) => logs.push(fields) });
}

beforeAll(async () => {
  await Promise.all([primary.start(), secondary.start()]);
});
afterAll(async () => {
  await Promise.all([primary.stop(), secondary.stop()]);
});
beforeEach(() => {
  for (const fake of [primary, secondary]) {
    fake.requests.length = 0;
    fake.dropped = 0;
    fake.behaviour = respondJson(200, answerBody());
  }
  secondary.behaviour = respondJson(200, answerBody("ELECTRICAL"));
  time.now = Date.UTC(2026, 11, 1, 6, 30);
  logs = [];
});

describe("PV4 failover", () => {
  it("the primary answers: DIRECT, with the provider name and a latency, and the secondary is not called", async () => {
    const result = await build().classify(INPUT);
    expect(result).toMatchObject({ arm: "DIRECT", provider: "opencode" });
    expect(result?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result?.categories.find((c) => c.label === "PLUMBING")?.probability).toBe(0.9);
    expect(secondary.requests).toHaveLength(0);
  });

  it.each([
    ["429", respondJson(429, {}, { "retry-after": "1" })],
    ["500", respondJson(500, {})],
    ["401", respondJson(401, {})],
    ["a timeout", hang],
    ["an invalid body", respondJson(200, { answers: {} })],
  ])("the primary fails with %s: the secondary answers", async (_name, behaviour) => {
    primary.behaviour = behaviour;
    const result = await build({ timeoutMs: 200 }).classify(INPUT);
    expect(result).toMatchObject({ provider: "jevmodel" });
    expect(primary.requests).toHaveLength(1);
    expect(secondary.requests).toHaveLength(1);
  });

  it("both fail: null, so the keyword fallback runs", async () => {
    primary.behaviour = respondJson(500, {});
    secondary.behaviour = hang;
    expect(await build({ timeoutMs: 200 }).classify(INPUT)).toBeNull();
  });

  it("the order is always primary first", async () => {
    const classifier = build();
    for (let i = 1; i <= 3; i += 1) {
      await classifier.classify(INPUT);
      expect(primary.requests).toHaveLength(i);
    }
    expect(secondary.requests).toHaveLength(0);
  });

  it("with only the secondary configured it is the one asked; with none the answer is null", async () => {
    expect(await build({ only: "secondary" }).classify(INPUT)).toMatchObject({ provider: "jevmodel" });
    expect(primary.requests).toHaveLength(0);
    expect(await new JevClassifier([], { timeoutMs: 400, cooldownMs: 1000 }).classify(INPUT)).toBeNull();
  });
});

describe("PV5 breaker inside the classifier", () => {
  it("opens after N failures, then skips the primary silently for the cooldown", async () => {
    primary.behaviour = respondJson(500, {});
    const classifier = build({ failures: 3 });
    for (let i = 0; i < 3; i += 1) await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(3);
    logs = [];
    expect(await classifier.classify(INPUT)).toMatchObject({ provider: "jevmodel" });
    expect(primary.requests).toHaveLength(3);
    expect(logs).toEqual([]);
  });

  it("half-open: after the cooldown ONE trial; a success recovers the primary", async () => {
    primary.behaviour = respondJson(500, {});
    const classifier = build({ failures: 2 });
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    time.now += 120_000;
    primary.behaviour = respondJson(200, answerBody());
    expect(await classifier.classify(INPUT)).toMatchObject({ provider: "opencode" });
    expect(await classifier.classify(INPUT)).toMatchObject({ provider: "opencode" });
    expect(primary.requests).toHaveLength(4);
  });

  it("half-open: a failed trial opens it again for a full cooldown", async () => {
    primary.behaviour = respondJson(500, {});
    const classifier = build({ failures: 2 });
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    time.now += 120_000;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(3);
    time.now += 119_999;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(3);
    time.now += 1;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(4);
  });

  it("a 429 opens it for Retry-After, but never longer than the cooldown", async () => {
    primary.behaviour = respondJson(429, {}, { "retry-after": "10" });
    const classifier = build();
    await classifier.classify(INPUT);
    time.now += 9_999;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(1);
    time.now += 1;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(2);
    primary.behaviour = respondJson(429, {}, { "retry-after": "86400" });
    time.now += 10_000;
    await classifier.classify(INPUT);
    time.now += 119_999;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(3);
    time.now += 1;
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(4);
  });

  it.each([401, 403])("a %i opens the breaker at once (after ONE request) and is logged once", async (status) => {
    primary.behaviour = respondJson(status, {});
    const classifier = build({ failures: 3 });
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(1);
    expect(logs.filter((l) => l.provider === "opencode")).toEqual([{ provider: "opencode", failure: "CONFIG", status, latencyMs: expect.any(Number) }]);
  });
});

describe("PV6 daily cap inside the classifier", () => {
  it("stops calling a provider at its cap, and starts again at midnight IST", async () => {
    const classifier = build({ cap: 2 });
    for (let i = 0; i < 4; i += 1) await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(2);
    expect(secondary.requests).toHaveLength(2);
    time.now = Date.UTC(2026, 11, 1, 18, 30);
    await classifier.classify(INPUT);
    expect(primary.requests).toHaveLength(3);
  });

  it("with both providers at the cap the answer is null and nobody is called", async () => {
    const classifier = build({ cap: 1 });
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    primary.requests.length = 0;
    secondary.requests.length = 0;
    expect(await classifier.classify(INPUT)).toBeNull();
    expect(primary.requests.length + secondary.requests.length).toBe(0);
  });
});

describe("PV7 the caller's budget", () => {
  it("both providers hang: the total time stays inside the budget and both requests are aborted", async () => {
    primary.behaviour = hang;
    secondary.behaviour = hang;
    const started = Date.now();
    const result = await build({ timeoutMs: 3000 }).classify(INPUT, { budgetMs: 600 });
    const took = Date.now() - started;
    expect(result).toBeNull();
    expect(took).toBeLessThan(800);
    expect(took).toBeGreaterThanOrEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(primary.dropped).toBe(1);
    expect(secondary.dropped).toBe(1);
  });

  it("a hanging primary leaves the secondary a share of the time to answer", async () => {
    primary.behaviour = hang;
    const started = Date.now();
    const result = await build({ timeoutMs: 3000 }).classify(INPUT, { budgetMs: 800 });
    expect(result).toMatchObject({ provider: "jevmodel" });
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("the caller's signal aborts the request in flight", async () => {
    primary.behaviour = hang;
    secondary.behaviour = hang;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const started = Date.now();
    expect(await build({ timeoutMs: 3000 }).classify(INPUT, { signal: controller.signal })).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(primary.dropped).toBe(1);
    expect(secondary.requests).toHaveLength(0);
  });

  it("a signal already aborted makes no request", async () => {
    expect(await build().classify(INPUT, { signal: AbortSignal.abort() })).toBeNull();
    expect(primary.requests).toHaveLength(0);
  });
});
