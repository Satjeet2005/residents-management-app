import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { GET } from "@/app/api/ops/error-test/route";
import { connect } from "./db";

/** D135: the real route file, through the real guard and database, finds its way into error_events. */

const TOKEN = "ops-integration-token-0123456789-abcdefghij";
let owner: Client;

beforeAll(async () => {
  owner = await connect();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await owner?.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  (globalThis as { townshipDb?: unknown }).townshipDb = undefined;
});

const request = (token?: string) => new Request("http://localhost/api/ops/error-test", { headers: token === undefined ? {} : { "x-ops-token": token } });

describe("D135 GET /api/ops/error-test", () => {
  it("is a 404 when OPS_TEST_TOKEN is not set, and when the token is wrong, and stores nothing", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    vi.stubEnv("OPS_TEST_TOKEN", "");
    const before = (await owner.query("SELECT count(*)::int AS n FROM error_events WHERE source = 'TEST'")).rows[0].n;
    expect((await GET(request(TOKEN))).status).toBe(404);
    vi.stubEnv("OPS_TEST_TOKEN", TOKEN);
    expect((await GET(request("wrong"))).status).toBe(404);
    expect((await GET(request())).status).toBe(404);
    expect((await owner.query("SELECT count(*)::int AS n FROM error_events WHERE source = 'TEST'")).rows[0].n).toBe(before);
  });

  it("with the right token it answers { ref } and the row is in the table", async () => {
    vi.stubEnv("DATABASE_URL", inject("testDatabaseUrl"));
    vi.stubEnv("OPS_TEST_TOKEN", TOKEN);
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { ref } = (await response.json()) as { ref: string };
    const { rows } = await owner.query("SELECT level, source, message, route FROM error_events WHERE ref = $1", [ref]);
    expect(rows).toEqual([{ level: "WARN", source: "TEST", message: "ops test", route: "/api/ops/error-test" }]);
  });
});
