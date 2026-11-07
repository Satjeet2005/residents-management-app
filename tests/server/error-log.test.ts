import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloodGate, buildEvent, defer, fingerprintOf, persistError, reportError, reportWarning, type ErrorLogDb, type StoredEvent } from "@/server/error-log";

/** D135: the durable error log, against fake databases. The real role and a real table are in tests/integration/error-log.test.ts. */

const SECRET = "pepper-value-for-the-test-0123456789";
const ENV = { OTP_PEPPER: SECRET, VERCEL_GIT_COMMIT_SHA: "abcdef0123456789", VERCEL_ENV: "production" };

type Call = unknown[];
function fakeDb(behaviour: (call: Call) => Promise<unknown> = async () => 1): { db: ErrorLogDb; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return behaviour(values);
    },
  } as unknown as ErrorLogDb;
  return { db, calls };
}
const never = () => new Promise<never>(() => undefined);

let lines: string[];
beforeEach(() => {
  lines = [];
  const keep = (line: unknown) => void lines.push(String(line));
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

function error(name: string, frame: string, code?: string): Error {
  const e = new Error("boom");
  e.name = name;
  e.stack = `${name}: boom\n    at ${frame}\n    at other (x.ts:1:1)`;
  return Object.assign(e, code === undefined ? {} : { code });
}

describe("D135 fingerprint", () => {
  const parts = { errorName: "Error", errorCode: "23505", route: "/api/payments", firstFrame: "at run (/app/src/pay.ts:10:5)" };

  it("is stable: the same error and route give the same SHA-256 hex value", () => {
    expect(fingerprintOf(parts)).toBe(fingerprintOf({ ...parts }));
    expect(fingerprintOf(parts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores line and column numbers in the first frame", () => {
    expect(fingerprintOf({ ...parts, firstFrame: "at run (/app/src/pay.ts:99:7)" })).toBe(fingerprintOf(parts));
  });

  it("differs by route, error name, error code and file", () => {
    const base = fingerprintOf(parts);
    for (const other of [{ route: "/api/me" }, { errorName: "TypeError" }, { errorCode: null }, { firstFrame: "at run (/app/src/other.ts:10:5)" }]) {
      expect(fingerprintOf({ ...parts, ...other })).not.toBe(base);
    }
  });

  it("treats ids in a path as one route", () => {
    expect(fingerprintOf({ ...parts, route: "/api/complaints/3f2b9c1e-0a4d-4b7e-9d3a-5c6e7f8a9b0c/close" })).toBe(
      fingerprintOf({ ...parts, route: "/api/complaints/11111111-2222-4333-8444-555555555555/close" }),
    );
    expect(fingerprintOf({ ...parts, route: "/api/x/12" })).toBe(fingerprintOf({ ...parts, route: "/api/x/99" }));
  });

  it("buildEvent gives the same fingerprint for the same error thrown twice, and a different one on another route", () => {
    const a = buildEvent({ ref: "E-AAAAAA", level: "ERROR", source: "ROUTE", route: "/api/a", error: error("Error", "f (a.ts:1:1)", "42P01") }, ENV);
    const b = buildEvent({ ref: "E-BBBBBB", level: "ERROR", source: "ROUTE", route: "/api/a", error: error("Error", "f (a.ts:5:9)", "42P01") }, ENV);
    const c = buildEvent({ ref: "E-CCCCCC", level: "ERROR", source: "ROUTE", route: "/api/b", error: error("Error", "f (a.ts:1:1)", "42P01") }, ENV);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });
});

describe("D135 buildEvent", () => {
  it("redacts and cuts every text, keeps only a UUID as the user, and records the commit and environment", () => {
    const event = buildEvent(
      { ref: "E-AAAAAA", level: "ERROR", source: "PAGE", route: `/x/${SECRET}`, method: "GET", digest: "123", userId: "not-a-uuid", role: "STAFF", error: new Error(`failed ${SECRET} for 9876543210`) },
      ENV,
    );
    expect(event).toMatchObject({ route: "/x/[secret]", userId: null, role: "STAFF", deployment: "abcdef0", environment: "production", digest: "123", errorCode: null });
    expect(event.message).toBe("failed [secret] for [secret]");
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(buildEvent({ ref: "E-AAAAAA", level: "ERROR", source: "ROUTE", route: "/x", userId: "3f2b9c1e-0a4d-4b7e-9d3a-5c6e7f8a9b0c" }, ENV).userId).toBe("3f2b9c1e-0a4d-4b7e-9d3a-5c6e7f8a9b0c");
  });

  it("a warning without a thrown value keeps its fixed name and message and has no code", () => {
    const event = buildEvent({ ref: "E-AAAAAA", level: "WARN", source: "PROVIDER", route: "classifier", errorName: "BreakerOpened", message: "provider primary breaker opened" }, ENV);
    expect(event).toMatchObject({ level: "WARN", errorName: "BreakerOpened", errorCode: null, message: "provider primary breaker opened", stack: null });
  });
});

describe("D135 flood protection", () => {
  it("allows 1 event per fingerprint per 60 seconds and counts the ones it skips", () => {
    let t = 1_000_000;
    const gate = new FloodGate(() => t);
    expect(gate.admit("a")).toBe(0);
    t += 1000;
    expect(gate.admit("a")).toBeNull();
    t += 1000;
    expect(gate.admit("a")).toBeNull();
    t += 57_999;
    expect(gate.admit("a")).toBeNull();
    t += 1;
    expect(gate.admit("a")).toBe(3);
    t += 60_000;
    expect(gate.admit("a")).toBe(0);
  });

  it("allows 20 events a minute in all, skips the 21st, and allows again when the minute has passed", () => {
    let t = 0;
    const gate = new FloodGate(() => t);
    for (let i = 0; i < 20; i++) expect(gate.admit(`f${i}`), `event ${i}`).toBe(0);
    expect(gate.admit("f20")).toBeNull();
    expect(gate.admit("f21")).toBeNull();
    t += 60_000;
    expect(gate.admit("f20")).toBe(1);
    expect(gate.admit("f21")).toBe(1);
  });

  it("the skipped count goes into suppressed_count of the next stored row of that fingerprint", async () => {
    let t = 0;
    const gate = new FloodGate(() => t);
    const { db, calls } = fakeDb();
    const event = buildEvent({ ref: "E-AAAAAA", level: "ERROR", source: "ROUTE", route: "/a", error: new Error("x") }, ENV);
    await persistError(event, db, { gate, env: ENV });
    await persistError({ ...event, ref: "E-BBBBBB" }, db, { gate, env: ENV });
    await persistError({ ...event, ref: "E-CCCCCC" }, db, { gate, env: ENV });
    expect(calls).toHaveLength(1);
    t += 61_000;
    await persistError({ ...event, ref: "E-DDDDDD" }, db, { gate, env: ENV });
    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)).toBe(2);
    expect(calls[0].at(-1)).toBe(0);
  });

  it("the table of fingerprints stays bounded under 5,000 different failures", () => {
    const gate = new FloodGate(() => 0);
    for (let i = 0; i < 5000; i++) gate.admit(`f${i}`);
    expect((gate as unknown as { byFingerprint: Map<string, unknown> }).byFingerprint.size).toBeLessThanOrEqual(500);
  });
});

describe("D135 persistError never throws", () => {
  const event = (): StoredEvent => buildEvent({ ref: "E-AAAAAA", level: "ERROR", source: "ROUTE", route: "/a", error: new Error("x") }, ENV);

  it("a rejecting database: it resolves, and one value-free line names the reference", async () => {
    const { db } = fakeDb(async () => {
      throw Object.assign(new Error(`connect failed ${SECRET}`), { code: "08006" });
    });
    await expect(persistError(event(), db, { gate: new FloodGate(), env: ENV })).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "warn", msg: "error event not stored", ref: "E-AAAAAA", code: "08006" });
    expect(lines[0]).not.toContain(SECRET);
  });

  it("a database client that throws at once, a missing client and non-Error rejections are all swallowed", async () => {
    for (const db of [{ $executeRaw: () => { throw "plain string"; } }, {}, { $executeRaw: () => Promise.reject(null) }]) {
      await expect(persistError(event(), db as unknown as ErrorLogDb, { gate: new FloodGate(), env: ENV })).resolves.toBeUndefined();
    }
  });

  it("a unique violation on the reference is retried once with a new reference", async () => {
    const refs: unknown[] = [];
    const { db } = fakeDb(async (values) => {
      refs.push(values[0]);
      if (refs.length === 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return 1;
    });
    await persistError(event(), db, { gate: new FloodGate(), newRef: () => "E-NEWREF", env: ENV });
    expect(refs).toEqual(["E-AAAAAA", "E-NEWREF"]);
  });

  it("a second unique violation is not retried again", async () => {
    const { db, calls } = fakeDb(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });
    await expect(persistError(event(), db, { gate: new FloodGate(), env: ENV })).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });
});

describe("D135 the store never delays or changes the response", () => {
  it("a database that hangs: reportError returns the reference within the 300 ms budget plus a margin", async () => {
    const { db } = fakeDb(never);
    const started = Date.now();
    const ref = await reportError(new Error("x"), { source: "ROUTE", route: "/a" }, db, { gate: new FloodGate(), env: ENV });
    expect(ref).toMatch(/^E-[0-9A-Z]{6}$/);
    expect(Date.now() - started).toBeLessThan(900);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("a database that rejects: the reference is returned at once and nothing is thrown", async () => {
    const { db } = fakeDb(async () => {
      throw new Error("down");
    });
    const started = Date.now();
    const ref = await reportError(new Error("x"), { source: "ROUTE", route: "/a" }, db, { gate: new FloodGate(), env: ENV });
    expect(ref).toMatch(/^E-/);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("reportWarning returns a reference and survives a hanging database", async () => {
    const { db } = fakeDb(never);
    const ref = await reportWarning({ source: "PROVIDER", route: "classifier", errorName: "BreakerOpened", message: "opened" }, db, { gate: new FloodGate(), env: ENV, budgetMs: 20 });
    expect(ref).toMatch(/^E-/);
  });

  it("defer waits no longer than the budget, and a rejecting task does not throw", async () => {
    const started = Date.now();
    await defer(never, 40);
    expect(Date.now() - started).toBeLessThan(400);
    await expect(defer(() => Promise.reject(new Error("x")), 40)).resolves.toBeUndefined();
  });

  it("reportError writes the stdout line with the same reference that it returns", async () => {
    const { db } = fakeDb();
    const ref = await reportError(new Error("x"), { source: "ACTION", route: "/staff" }, db, { gate: new FloodGate(), env: ENV });
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", source: "ACTION", ref });
  });

  it("a stored row holds no secret and no number of 10 digits, even from an error full of them", async () => {
    const { db, calls } = fakeDb();
    await reportError(error("Error", `run (${SECRET}.ts:1:1)`), { source: "ROUTE", route: `/api/${SECRET}` }, db, { gate: new FloodGate(), env: { ...ENV } });
    await reportError(new Error(`phone 9876543210 key ${SECRET} mail a@b.com`), { source: "ROUTE", route: "/api/other" }, db, { gate: new FloodGate(), env: ENV });
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(JSON.stringify(call)).not.toMatch(new RegExp(`${SECRET}|9876543210|a@b\\.com`));
  });
});

describe("D135 with Next's after", () => {
  it("runs the store after the response: reportError returns before the work, and the work still stores the row", async () => {
    vi.resetModules();
    let scheduled: (() => Promise<void>) | undefined;
    vi.doMock("next/server", () => ({ after: (work: () => Promise<void>) => void (scheduled = work) }));
    const fresh = await import("@/server/error-log");
    const { db, calls } = fakeDb();
    const ref = await fresh.reportError(new Error("x"), { source: "ROUTE", route: "/a" }, db, { gate: new fresh.FloodGate(), env: ENV });
    expect(ref).toMatch(/^E-/);
    expect(calls).toHaveLength(0);
    await scheduled?.();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(ref);
    vi.doUnmock("next/server");
    vi.resetModules();
  });
});
