import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditDenied } from "@/server/auth/guard";
import { withDeadlockRetry } from "@/server/db-retry";
import { resetWarnOnce, warnOnce, type ErrorLogDb } from "@/server/error-log";
import { CircuitBreaker } from "@/server/complaints/providers/breaker";
import { DailyCap } from "@/server/complaints/providers/cap";
import { JevClassifier, type ProviderWarning } from "@/server/complaints/providers/classifier-jev";
import { JevClient } from "@/server/complaints/providers/client";
import { answerBody, FakeProvider, respondJson } from "./complaints/providers/fake-provider";

/** D135: the small fixed set of WARN events. Each is sent once per cooldown, and none is sent for an ordinary failure. */

let lines: string[];
beforeEach(() => {
  lines = [];
  resetWarnOnce();
  const keep = (line: unknown) => void lines.push(String(line));
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

function fakeDb() {
  const inserted: unknown[][] = [];
  const db = { $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => void inserted.push(values) } as unknown as ErrorLogDb;
  return { db, inserted };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const WARNING = { source: "PROVIDER", route: "classifier", errorName: "ProviderBreakerOpened", message: "opened" } as const;

describe("D135 warnOnce", () => {
  it("sends the first warning, skips the same key within the cooldown, and sends it again after", async () => {
    const { db, inserted } = fakeDb();
    let t = 0;
    const now = () => t;
    expect(warnOnce("k", 1000, WARNING, db, { now })).toBe(true);
    t = 999;
    expect(warnOnce("k", 1000, WARNING, db, { now })).toBe(false);
    t = 1000;
    expect(warnOnce("k", 1000, WARNING, db, { now })).toBe(true);
    await settle();
    expect(inserted.length).toBeGreaterThanOrEqual(1);
  });

  it("keys are independent, and Infinity means once per instance", () => {
    const { db } = fakeDb();
    const now = () => 5e12;
    expect(warnOnce("a", 1000, WARNING, db, { now })).toBe(true);
    expect(warnOnce("b", 1000, WARNING, db, { now })).toBe(true);
    expect(warnOnce("c", Number.POSITIVE_INFINITY, WARNING, db, { now: () => 0 })).toBe(true);
    expect(warnOnce("c", Number.POSITIVE_INFINITY, WARNING, db, { now: () => 9e15 })).toBe(false);
  });

  it("never throws, whatever the database is", () => {
    expect(() => warnOnce("x", 1, WARNING, undefined as unknown as ErrorLogDb)).not.toThrow();
  });
});

describe("D135 deadlock retries exhausted", () => {
  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
  const sleep = async () => undefined;

  it("calls onExhausted once when the retries run out, and still throws the deadlock", async () => {
    const onExhausted = vi.fn();
    await expect(withDeadlockRetry(async () => { throw deadlock(); }, { retries: 2, sleep, onExhausted })).rejects.toThrow("deadlock detected");
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("does not call it when a retry succeeds, or for another error", async () => {
    const onExhausted = vi.fn();
    let runs = 0;
    await withDeadlockRetry(async () => { if (++runs === 1) throw deadlock(); return 1; }, { retries: 2, sleep, onExhausted });
    await expect(withDeadlockRetry(async () => { throw new Error("boom"); }, { retries: 2, sleep, onExhausted })).rejects.toThrow("boom");
    expect(onExhausted).not.toHaveBeenCalled();
  });
});

describe("D135 the audit address hash", () => {
  it("is a WARN once per instance when the hash is unavailable, and the refusal is still audited", async () => {
    const { db, inserted } = fakeDb();
    const deps = { db: { ...db, auditLog: { create: vi.fn(async () => ({})) } } as never, sender: {} as never, now: () => 0, ip: () => { throw new Error("no pepper"); } };
    const request = new Request("http://localhost/api/x");
    const user = { id: "u", role: "RESIDENT", active: true, permissions: [] } as never;
    await auditDenied(deps, request, user, "STAFF", 0);
    await auditDenied(deps, request, user, "STAFF", 1);
    await settle();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain("AUDIT");
    expect((deps.db as unknown as { auditLog: { create: ReturnType<typeof vi.fn> } }).auditLog.create).toHaveBeenCalledTimes(2);
  });
});

describe("D135 classifier provider warnings", () => {
  const provider = new FakeProvider();
  const time = { now: Date.UTC(2026, 11, 1, 6, 30) };
  beforeAll(() => provider.start());
  afterAll(() => provider.stop());

  const build = (warnings: ProviderWarning[]) =>
    new JevClassifier(
      [{ client: new JevClient({ name: "opencode", url: provider.url, model: "m", key: "test-key-not-a-secret-123" }), breaker: new CircuitBreaker({ failures: 3, cooldownMs: 120_000, now: () => time.now }), cap: new DailyCap(1000, () => time.now) }],
      { timeoutMs: 400, cooldownMs: 120_000, log: () => undefined, warn: (w) => warnings.push(w) },
    );
  const INPUT = { text: "the tap is leaking", arm: "DIRECT" } as const;

  it("the breaker opening is reported once, after the third failure and not before", async () => {
    provider.behaviour = respondJson(500, {});
    const warnings: ProviderWarning[] = [];
    const classifier = build(warnings);
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    expect(warnings).toEqual([]);
    await classifier.classify(INPUT);
    expect(warnings).toEqual([{ kind: "BREAKER_OPENED", provider: "opencode", cooldownMs: 120_000 }]);
    await classifier.classify(INPUT);
    expect(warnings).toHaveLength(1);
  });

  it.each([401, 403])("a %i is reported at once as an authentication failure, once per cooldown", async (status) => {
    provider.behaviour = respondJson(status, {});
    const warnings: ProviderWarning[] = [];
    const classifier = build(warnings);
    await classifier.classify(INPUT);
    await classifier.classify(INPUT);
    expect(warnings).toEqual([{ kind: "AUTH_FAILED", provider: "opencode", status, cooldownMs: 120_000 }]);
  });

  it("a success, and one ordinary failure, report nothing", async () => {
    const warnings: ProviderWarning[] = [];
    provider.behaviour = respondJson(200, answerBody());
    await build(warnings).classify(INPUT);
    provider.behaviour = respondJson(500, {});
    await build(warnings).classify(INPUT);
    expect(warnings).toEqual([]);
  });
});
