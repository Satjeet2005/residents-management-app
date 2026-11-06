import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleWebhook } from "@/server/payments/handlers";
import { TIMESTAMP_WINDOW_SECONDS, signWebhook, verifyWebhook } from "@/server/payments/webhook";

/** A fixed 40-character secret that is only for tests. */
export const TEST_SECRET = "test-webhook-secret-0123456789abcdef-xx";
const NOW = Date.UTC(2026, 9, 27, 6, 30, 0);
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ eventId: "evt-1", type: "payment.succeeded", reference: "MOCK-a1", amountPaise: "646800", ...over });
const headers = (raw: string, over: Record<string, string> = {}, at = NOW) => new Headers({ ...signWebhook(raw, TEST_SECRET, at, { NODE_ENV: "test" }), ...over });
const verify = (raw: string, h: Headers, now = NOW, secret: string | undefined = TEST_SECRET) => verifyWebhook(raw, h, secret, now, { NODE_ENV: "test" });

describe("PY5 verifyWebhook: the signature (HMAC-SHA256 of timestamp.body, constant time)", () => {
  it("accepts a correctly signed event and reads it, with the amount as a bigint", () => {
    const raw = body();
    expect(verify(raw, headers(raw))).toEqual({ kind: "OK", event: { eventId: "evt-1", type: "payment.succeeded", reference: "MOCK-a1", amountPaise: 646_800n } });
  });

  it("the signature is the hex HMAC-SHA256 of `${timestamp}.${rawBody}`, written out independently", () => {
    const raw = body();
    const h = signWebhook(raw, TEST_SECRET, NOW, { NODE_ENV: "test" });
    expect(h["x-signature"]).toBe(createHmac("sha256", TEST_SECRET).update(`${h["x-timestamp"]}.${raw}`).digest("hex"));
    expect(h["x-timestamp"]).toBe(String(NOW / 1000));
  });

  it.each<[string, (raw: string) => Headers]>([
    ["no headers at all", () => new Headers()],
    ["no signature", (raw) => { const h = headers(raw); h.delete("x-signature"); return h; }],
    ["no timestamp", (raw) => { const h = headers(raw); h.delete("x-timestamp"); return h; }],
    ["an empty signature", (raw) => headers(raw, { "x-signature": "" })],
    ["a signature that is not hex", (raw) => headers(raw, { "x-signature": "z".repeat(64) })],
    ["a short signature (32 hex digits)", (raw) => headers(raw, { "x-signature": headers(raw)["get"]("x-signature")!.slice(0, 32) })],
    ["a long signature (a digit added)", (raw) => headers(raw, { "x-signature": `${headers(raw).get("x-signature")}0` })],
    ["a wrong signature of the right shape", (raw) => headers(raw, { "x-signature": "0".repeat(64) })],
    ["a signature made with another secret", (raw) => new Headers(signWebhook(raw, "another-secret-another-secret-another-0", NOW, { NODE_ENV: "test" }))],
    ["a timestamp that is not whole seconds", (raw) => headers(raw, { "x-timestamp": "1.5" })],
    ["a negative timestamp", (raw) => headers(raw, { "x-timestamp": "-5" })],
    ["a timestamp in milliseconds", (raw) => headers(raw, { "x-timestamp": String(NOW) })],
  ])("%s is BAD_SIGNATURE", (_label, makeHeaders) => {
    const raw = body();
    expect(verify(raw, makeHeaders(raw))).toEqual({ kind: "BAD_SIGNATURE" });
  });

  it("a tampered body fails: changing the amount by one paise, the type or the reference breaks the signature", () => {
    const raw = body();
    const h = headers(raw);
    for (const changed of [body({ amountPaise: "646801" }), body({ type: "payment.failed" }), body({ reference: "MOCK-a2" }), `${raw} `]) {
      expect(verify(changed, h)).toEqual({ kind: "BAD_SIGNATURE" });
    }
  });

  it("a signature made for another body fails", () => {
    const other = body({ eventId: "evt-2" });
    expect(verify(body(), headers(other))).toEqual({ kind: "BAD_SIGNATURE" });
  });

  it("an upper-case hex signature is the same signature", () => {
    const raw = body();
    const h = headers(raw);
    h.set("x-signature", h.get("x-signature")!.toUpperCase());
    expect(verify(raw, h).kind).toBe("OK");
  });
});

describe("PY5 verifyWebhook: the timestamp window of 5 minutes", () => {
  const at = (offsetSeconds: number) => {
    const raw = body();
    return verify(raw, headers(raw, {}, NOW + offsetSeconds * 1000), NOW).kind;
  };
  it("the window is 300 seconds", () => {
    expect(TIMESTAMP_WINDOW_SECONDS).toBe(300);
  });
  it.each<[number, string]>([
    [0, "OK"],
    [-299, "OK"],
    [-300, "OK"],
    [-301, "BAD_SIGNATURE"],
    [299, "OK"],
    [300, "OK"],
    [301, "BAD_SIGNATURE"],
    [-3600, "BAD_SIGNATURE"],
    [86_400, "BAD_SIGNATURE"],
  ])("a request signed %i seconds from now is %s", (offset, expected) => {
    expect(at(offset)).toBe(expected);
  });

  it("an old request replayed after 5 minutes is refused even though its signature is genuine", () => {
    const raw = body();
    const h = headers(raw);
    expect(verify(raw, h, NOW + 4 * 60_000).kind).toBe("OK");
    expect(verify(raw, h, NOW + 5 * 60_000 + 2_000)).toEqual({ kind: "BAD_SIGNATURE" });
  });
});

describe("PY5 verifyWebhook: the body, once the signature is good", () => {
  it.each<[string, string]>([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a missing reference", JSON.stringify({ eventId: "e", type: "payment.succeeded", amountPaise: "1" })],
    ["an unknown type", body({ type: "payment.refunded" })],
    ["a numeric amount", body({ amountPaise: 646800 })],
    ["a fractional amount", body({ amountPaise: "6468.5" })],
    ["a negative amount", body({ amountPaise: "-1" })],
    ["an empty event id", body({ eventId: "" })],
    ["an over-long reference", body({ reference: "x".repeat(201) })],
  ])("%s is BAD_BODY", (_label, raw) => {
    expect(verify(raw, headers(raw))).toEqual({ kind: "BAD_BODY" });
  });

  it("an extra field is dropped, never passed on", () => {
    const raw = body({ flatId: "other" });
    const result = verify(raw, headers(raw));
    expect(result.kind === "OK" && Object.keys(result.event).sort()).toEqual(["amountPaise", "eventId", "reference", "type"]);
  });
});

describe("PY5 the secret fails closed", () => {
  const raw = body();
  const h = () => headers(raw);
  it.each<[string | undefined]>([[undefined], [""]])("a missing secret (%j) throws in every environment", (secret) => {
    expect(() => verifyWebhook(raw, h(), secret, NOW, { NODE_ENV: "test" })).toThrow(/not set/);
    expect(() => verifyWebhook(raw, h(), secret, NOW, { NODE_ENV: "production" })).toThrow(/not set/);
  });

  it.each<[string]>([["short-secret"], ["x".repeat(31)], ["replace-with-a-long-random-string-of-32-or-more-characters"]])("in production %j is refused", (secret) => {
    expect(() => verifyWebhook(raw, h(), secret, NOW, { NODE_ENV: "production" })).toThrow(/at least 32 characters/);
  });

  it("in production a 32-character secret works", () => {
    const secret = "k".repeat(32);
    const signed = new Headers(signWebhook(raw, secret, NOW, { NODE_ENV: "production" }));
    expect(verifyWebhook(raw, signed, secret, NOW, { NODE_ENV: "production" }).kind).toBe("OK");
  });

  it("outside production a short secret is accepted, which keeps local runs simple", () => {
    expect(() => signWebhook(raw, "short", NOW, { NODE_ENV: "development" })).not.toThrow();
  });

  it("the error never contains the secret", () => {
    try {
      verifyWebhook(raw, h(), "weak-weak-weak", NOW, { NODE_ENV: "production" });
    } catch (error) {
      expect(String(error)).not.toContain("weak-weak-weak");
    }
  });
});

describe("PY5 handleWebhook answers without touching the database when the signature is bad", () => {
  const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } }) as never;
  const call = (raw: string, h: Headers) =>
    handleWebhook({ request: new Request("http://localhost/api/payments/webhook", { method: "POST", headers: h, body: raw }), deps: { db: untouchable, now: () => NOW } }, { env: { NODE_ENV: "test", PAYMENT_WEBHOOK_SECRET: TEST_SECRET } });

  it("a missing signature is 401 { error: BAD_SIGNATURE } and nothing else", async () => {
    const response = await call(body(), new Headers());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "BAD_SIGNATURE" });
  });

  it("a wrong signature, and a genuine one that is 6 minutes old, are 401", async () => {
    const raw = body();
    expect((await call(raw, headers(raw, { "x-signature": "a".repeat(64) }))).status).toBe(401);
    expect((await call(raw, headers(raw, {}, NOW - 6 * 60_000))).status).toBe(401);
  });

  it("a signed body that is not valid is 400, and an over-long body is 400 before anything is checked", async () => {
    const bad = JSON.stringify({ eventId: "e" });
    expect((await call(bad, headers(bad))).status).toBe(400);
    const big = body({ reference: "y".repeat(5000) });
    expect((await call(big, headers(big))).status).toBe(400);
  });

  it("a missing secret throws, so the guard answers a plain 500 and nothing is processed", async () => {
    const raw = body();
    await expect(
      handleWebhook({ request: new Request("http://localhost/x", { method: "POST", headers: headers(raw), body: raw }), deps: { db: untouchable, now: () => NOW } }, { env: { NODE_ENV: "production" } }),
    ).rejects.toThrow(/not set/);
  });
});
