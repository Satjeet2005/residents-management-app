import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorLogDb } from "@/server/error-log";
import { MAX_CALLS_PER_HOUR, createErrorTestHandler } from "@/server/ops/error-test";

/** D135: GET /api/ops/error-test. A plain 404 unless the token is set (32+ characters) and sent; 5 calls an hour; one TEST event per call. */

const TOKEN = "ops-test-token-0123456789-abcdefghijklmnop";
let inserted: unknown[][];
const db = { $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => void inserted.push(values) } as unknown as ErrorLogDb;
const call = (handle: ReturnType<typeof createErrorTestHandler>, token?: string) =>
  handle(new Request("http://localhost/api/ops/error-test", { headers: token === undefined ? {} : { "x-ops-token": token } }), db);

beforeEach(() => {
  inserted = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("D135 the ops error-test route is hidden", () => {
  it.each([
    ["the variable is not set", {}],
    ["the variable is empty", { OPS_TEST_TOKEN: "" }],
    ["the token is 31 characters", { OPS_TEST_TOKEN: "x".repeat(31) }],
  ] as [string, Record<string, string>][])("%s: a plain 404 with no body, even with the right header, and nothing is stored", async (_title, env) => {
    const handle = createErrorTestHandler({ env });
    for (const token of [undefined, "wrong", env.OPS_TEST_TOKEN ?? "x".repeat(31)]) {
      const response = await call(handle, token);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(inserted).toHaveLength(0);
  });

  it("a wrong token, a missing header, a token of another length and a prefix of the right one are all 404, never 401", async () => {
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN } });
    for (const token of [undefined, "", "wrong", TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) {
      expect((await call(handle, token)).status, String(token)).toBe(404);
    }
    expect(inserted).toHaveLength(0);
  });
});

describe("D135 the ops error-test route with the right token", () => {
  it("stores ONE test event (source TEST, level WARN, message 'ops test') and returns its reference", async () => {
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN } });
    const response = await call(handle, TOKEN);
    expect(response.status).toBe(200);
    const { ref } = (await response.json()) as { ref: string };
    expect(ref).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(expect.arrayContaining([ref, "WARN", "TEST", "/api/ops/error-test", "OpsTest", "ops test"]));
  });

  it("every call is stored, even two in the same second (the flood gate does not hide a test event)", async () => {
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN } });
    await call(handle, TOKEN);
    await call(handle, TOKEN);
    expect(inserted).toHaveLength(2);
  });

  it("allows 5 calls an hour, answers the 6th with 429, and allows again when the hour has passed", async () => {
    let t = 0;
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN }, now: () => t });
    for (let i = 0; i < MAX_CALLS_PER_HOUR; i++) expect((await call(handle, TOKEN)).status).toBe(200);
    const limited = await call(handle, TOKEN);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "RATE_LIMITED" });
    expect(inserted).toHaveLength(5);
    t = 3_600_000;
    expect((await call(handle, TOKEN)).status).toBe(200);
  });

  it("calls with a wrong token do not use up the allowance", async () => {
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN } });
    for (let i = 0; i < 20; i++) await call(handle, "wrong");
    expect((await call(handle, TOKEN)).status).toBe(200);
  });

  it("the response carries only the reference: no token, no secret", async () => {
    const handle = createErrorTestHandler({ env: { OPS_TEST_TOKEN: TOKEN } });
    const text = await (await call(handle, TOKEN)).text();
    expect(Object.keys(JSON.parse(text))).toEqual(["ref"]);
    expect(text).not.toContain(TOKEN);
  });
});
