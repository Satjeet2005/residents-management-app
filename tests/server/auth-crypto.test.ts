import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeHash, hashesEqual, ipHash, newSessionToken, randomBytesFor, sessionTokenHash } from "@/server/auth/crypto";

const PEPPER = "test-pepper-test-pepper-test-pepper-123";

beforeEach(() => {
  vi.stubEnv("OTP_PEPPER", PEPPER);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("S-A1 codeHash and ipHash", () => {
  it("codeHash is a 64-character hex HMAC and is stable", () => {
    const hash = codeHash("5000000001", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash("5000000001", "123456")).toBe(hash);
  });

  it("codeHash changes with the phone, the code and the pepper", () => {
    const base = codeHash("5000000001", "123456");
    expect(codeHash("5000000002", "123456")).not.toBe(base);
    expect(codeHash("5000000001", "123457")).not.toBe(base);
    vi.stubEnv("OTP_PEPPER", `${PEPPER}-other`);
    expect(codeHash("5000000001", "123456")).not.toBe(base);
  });

  it("does not contain the code or the pepper", () => {
    const hash = codeHash("5000000001", "123456");
    expect(hash).not.toContain("123456");
    expect(hash).not.toContain(PEPPER);
  });

  it("ipHash is a 64-character hex HMAC, stable, and different per address", () => {
    const hash = ipHash("203.0.113.9");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash("203.0.113.9")).toBe(hash);
    expect(ipHash("203.0.113.10")).not.toBe(hash);
    expect(hash).not.toContain("203.0.113.9");
  });

  it("matches an independent HMAC-SHA256 computation", async () => {
    const { createHmac } = await import("node:crypto");
    expect(codeHash("5000000001", "123456")).toBe(createHmac("sha256", PEPPER).update("5000000001:123456").digest("hex"));
    expect(ipHash("1.2.3.4")).toBe(createHmac("sha256", PEPPER).update("ip:1.2.3.4").digest("hex"));
  });
});

describe("S-A1 hashesEqual", () => {
  it("is true for equal digests and false for different ones", () => {
    const a = codeHash("5000000001", "123456");
    expect(hashesEqual(a, codeHash("5000000001", "123456"))).toBe(true);
    expect(hashesEqual(a, codeHash("5000000001", "654321"))).toBe(false);
  });

  it("is false for different lengths and for empty strings against a digest", () => {
    expect(hashesEqual("abc", "abcd")).toBe(false);
    expect(hashesEqual("", codeHash("5000000001", "1"))).toBe(false);
    expect(hashesEqual("", "")).toBe(true);
  });
});

describe("S-A1 session tokens", () => {
  it("a token is 43 base64url characters (32 bytes) and never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("sessionTokenHash is SHA-256 in hex, stable, and does not contain the token", () => {
    const token = newSessionToken();
    const hash = sessionTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionTokenHash(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(sessionTokenHash("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it("randomBytesFor returns the number of bytes asked for", () => {
    expect(randomBytesFor(16)).toHaveLength(16);
  });
});

describe("V7 the pepper fails closed", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("a %s pepper throws in any environment, and nothing is returned", (_label, value) => {
    if (value === undefined) vi.stubEnv("OTP_PEPPER", undefined as unknown as string);
    else vi.stubEnv("OTP_PEPPER", value);
    expect(() => codeHash("5000000001", "123456")).toThrow("OTP_PEPPER");
    expect(() => ipHash("1.2.3.4")).toThrow("OTP_PEPPER");
  });

  it.each([
    ["missing", ""],
    ["31 characters", "x".repeat(31)],
    ["short", "short"],
    ["the .env.example placeholder", "replace-with-another-long-random-string"],
  ])("in production a %s pepper throws at first use, without printing it", (_label, value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", value);
    const attempt = () => codeHash("5000000001", "123456");
    expect(attempt).toThrow("OTP_PEPPER");
    try {
      attempt();
    } catch (error) {
      if (value !== "") expect((error as Error).message).not.toContain(value);
    }
  });

  it("in production a pepper of 32 characters works", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "x".repeat(32));
    expect(codeHash("5000000001", "123456")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("outside production a short pepper is accepted", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_PEPPER", "short");
    expect(codeHash("5000000001", "123456")).toMatch(/^[0-9a-f]{64}$/);
  });
});
