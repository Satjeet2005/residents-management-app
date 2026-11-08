import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JevClient, MAX_RESPONSE_BYTES } from "@/server/complaints/providers/client";
import { answerBody, FakeProvider, hang, respondJson } from "./fake-provider";

const KEY = "test-key-not-a-secret-123";
const provider = new FakeProvider();
const client = () => new JevClient({ name: "opencode", url: provider.url, model: "jev-latest", key: KEY });

beforeAll(async () => {
  await provider.start();
});
afterAll(() => provider.stop());
beforeEach(() => {
  provider.requests.length = 0;
  provider.dropped = 0;
  provider.behaviour = respondJson(200, answerBody());
});

describe("JevClient: the request", () => {
  it("POSTs JSON with the Bearer key, and the body holds only the model, the text and the two questions", async () => {
    const outcome = await client().call("a tap is leaking", { timeoutMs: 1000 });
    expect(outcome.ok).toBe(true);
    const [request] = provider.requests;
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request.headers["content-type"]).toBe("application/json");
    const body = request.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body.state).toBe("a tap is leaking");
    expect(body.model).toBe("jev-latest");
  });

  it("a fractional timeout (a share of the caller's budget) does not throw", async () => {
    const outcome = await client().call("x", { timeoutMs: 299.5 });
    expect(outcome).toMatchObject({ ok: true, status: 200 });
  });

  it("a 2xx answer is parsed into the two distributions with the status and a latency", async () => {
    const outcome = await client().call("x", { timeoutMs: 1000 });
    expect(outcome).toMatchObject({ ok: true, status: 200 });
    if (outcome.ok) {
      expect(outcome.value.categories[0]).toEqual({ label: "PLUMBING", probability: 0.9 });
      expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("JevClient: status mapping", () => {
  it.each([
    [401, "CONFIG"],
    [403, "CONFIG"],
    [429, "RATE_LIMITED"],
    [500, "SERVER"],
    [503, "SERVER"],
    [529, "SERVER"],
    [400, "REJECTED"],
    [422, "REJECTED"],
    [404, "REJECTED"],
  ])("%i is %s, with the status kept", async (status, failure) => {
    provider.behaviour = respondJson(status, { detail: "no" });
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure, status });
  });

  it("a 429 reports Retry-After in whole seconds, and an HTTP date or a missing header as not given", async () => {
    provider.behaviour = respondJson(429, {}, { "retry-after": "17" });
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ failure: "RATE_LIMITED", retryAfterSeconds: 17 });
    provider.behaviour = respondJson(429, {}, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ failure: "RATE_LIMITED", retryAfterSeconds: undefined });
    provider.behaviour = respondJson(429, {});
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ failure: "RATE_LIMITED", retryAfterSeconds: undefined });
  });

  it("one call makes one request: a failure is never retried", async () => {
    provider.behaviour = respondJson(500, {});
    await client().call("x", { timeoutMs: 1000 });
    expect(provider.requests).toHaveLength(1);
  });
});

describe("PV3 hostile answers give a failure", () => {
  it("a redirect is not followed", async () => {
    provider.behaviour = (_request, response) => {
      response.writeHead(302, { location: `${provider.url}/elsewhere` });
      response.end();
    };
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "REDIRECT", status: 302 });
    expect(provider.requests).toHaveLength(1);
  });

  it("a body that declares more than 64 KB is refused", async () => {
    provider.behaviour = (_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-length": String(MAX_RESPONSE_BYTES + 1) });
      response.end("x".repeat(MAX_RESPONSE_BYTES + 1));
    };
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "TOO_LARGE" });
  });

  it("a streamed body over 64 KB is cut off", async () => {
    provider.behaviour = (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write(`{"pad":"${"x".repeat(MAX_RESPONSE_BYTES)}`);
      response.end(`"}`);
    };
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "TOO_LARGE" });
  });

  it.each([
    ["not JSON", "<html>hello</html>"],
    ["an empty body", ""],
    ["JSON of the wrong shape", JSON.stringify({ answers: {} })],
  ])("%s on a 200 is INVALID", async (_name, text) => {
    provider.behaviour = (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(text);
    };
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "INVALID", status: 200 });
  });

  it("an answer that says CRITICAL is INVALID", async () => {
    const body = answerBody() as { answers: { urgency: { probabilities: Record<string, number> } } };
    body.answers.urgency.probabilities = { CRITICAL: 0.9, NORMAL: 0.05, LOW: 0.05 };
    provider.behaviour = respondJson(200, body);
    expect(await client().call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "INVALID" });
  });
});

describe("JevClient: time and network", () => {
  it("a provider that never answers ends at the timeout", async () => {
    provider.behaviour = hang;
    const started = Date.now();
    const outcome = await client().call("x", { timeoutMs: 150 });
    expect(outcome).toMatchObject({ ok: false, failure: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("the caller's signal ends the call too, and the server sees the request dropped", async () => {
    provider.behaviour = hang;
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.dropped = 0;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const outcome = await client().call("x", { timeoutMs: 3000, signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, failure: "ABORTED" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(provider.dropped).toBe(1);
  });

  it("a signal that is already aborted makes no answer", async () => {
    expect(await client().call("x", { timeoutMs: 1000, signal: AbortSignal.abort() })).toMatchObject({ ok: false, failure: "ABORTED" });
  });

  it("a closed port is NETWORK", async () => {
    const dead = new FakeProvider();
    await dead.start();
    const url = dead.url;
    await dead.stop();
    expect(await new JevClient({ name: "jevmodel", url, model: "m", key: KEY }).call("x", { timeoutMs: 1000 })).toMatchObject({ ok: false, failure: "NETWORK" });
  });
});
