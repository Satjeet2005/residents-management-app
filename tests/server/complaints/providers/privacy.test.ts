import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClassifierFromEnv } from "@/server/complaints/providers/factory";
import { buildRequest } from "@/server/complaints/providers/system-one";
import { answerBody, FakeProvider, hang, respondJson } from "./fake-provider";

const KEY = "test-key-not-a-secret-123";
const TEXT = "the tap in the pantry of the clubhouse is dripping since Monday";
const BODY_SECRET = "response-body-secret-text";
const fake = new FakeProvider();
let output: string[] = [];

const classifier = () =>
  createClassifierFromEnv({ JEV_PRIMARY_URL: `${fake.url}?token=query-secret`, JEV_PRIMARY_MODEL: "jev-latest", JEV_PRIMARY_KEY: KEY, JEV_TIMEOUT_MS: "500", JEV_BREAKER_FAILURES: "20" });
const ask = (c: ReturnType<typeof classifier>) => c.classify({ text: TEXT, arm: "DIRECT" });

beforeAll(async () => {
  await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => {
  fake.requests.length = 0;
  fake.behaviour = respondJson(200, answerBody());
  output = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("PV8 privacy", () => {
  it("the request body is exactly the model, the given text and the two questions", async () => {
    await ask(classifier());
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].raw).toBe(JSON.stringify(buildRequest(TEXT, "jev-latest")));
    expect(fake.requests[0].path).toContain("/v1/systemone");
  });

  it("the key travels only in the Authorization header", async () => {
    await ask(classifier());
    expect(fake.requests[0].raw).not.toContain(KEY);
    expect(fake.requests[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("console output after every kind of failure never holds the key, the text, the URL, its query or a response body", async () => {
    const failures = [
      respondJson(401, { detail: BODY_SECRET }),
      respondJson(403, { detail: BODY_SECRET }),
      respondJson(429, { detail: BODY_SECRET }, { "retry-after": "1" }),
      respondJson(500, { detail: BODY_SECRET }),
      respondJson(200, { detail: BODY_SECRET }),
      (_request: unknown, response: { writeHead: (s: number, h: Record<string, string>) => void; end: () => void }) => {
        response.writeHead(302, { location: `${fake.url}/redirected?secret=1` });
        response.end();
      },
      hang,
    ];
    for (const behaviour of failures) {
      fake.behaviour = behaviour as typeof fake.behaviour;
      await ask(classifier());
    }
    expect(output.length).toBeGreaterThanOrEqual(failures.length - 2);
    const all = output.join("\n");
    for (const forbidden of [KEY, TEXT, "pantry", BODY_SECRET, fake.url, "127.0.0.1", "query-secret", "/v1/systemone", "redirected", "Bearer"]) {
      expect(all, forbidden).not.toContain(forbidden);
    }
    expect(all).toContain("classifier provider failed: provider=opencode failure=SERVER status=500");
  });

  it("a success logs nothing", async () => {
    await ask(classifier());
    expect(output).toEqual([]);
  });

  it("a 401 opens the breaker and is logged once, however many complaints follow", async () => {
    fake.behaviour = respondJson(401, {});
    const c = classifier();
    for (let i = 0; i < 4; i += 1) await ask(c);
    expect(fake.requests).toHaveLength(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toBe("classifier provider failed: provider=opencode failure=CONFIG status=401 latency_ms=" + /latency_ms=(\d+)/.exec(output[0])?.[1]);
  });
});
