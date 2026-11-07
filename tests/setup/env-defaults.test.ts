import { afterEach, describe, expect, it, vi } from "vitest";

/** D128: the setup file gives the suite its two secrets when the environment has none, and never overrides one that is set. */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("D128 test environment defaults", () => {
  it("the suite always has an OTP_PEPPER and a PAYMENT_WEBHOOK_SECRET of at least 32 characters (CI has no .env)", () => {
    expect((process.env.OTP_PEPPER ?? "").length).toBeGreaterThanOrEqual(32);
    expect((process.env.PAYMENT_WEBHOOK_SECRET ?? "").length).toBeGreaterThanOrEqual(32);
  });

  it("fills an unset variable with a fixed 40-character test value and leaves DEMO_MODE alone", async () => {
    vi.stubEnv("OTP_PEPPER", undefined as unknown as string);
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", undefined as unknown as string);
    vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    await import("./env-defaults");
    expect(process.env.OTP_PEPPER).toBe("test-only-otp-pepper-not-a-secret-000001");
    expect(process.env.PAYMENT_WEBHOOK_SECRET).toBe("test-only-webhook-secret-not-real-000001");
    expect(process.env.OTP_PEPPER).toHaveLength(40);
    expect(process.env.PAYMENT_WEBHOOK_SECRET).toHaveLength(40);
    expect(process.env.DEMO_MODE).toBeUndefined();
  });

  it("does not override a value that is already set", async () => {
    vi.stubEnv("OTP_PEPPER", "a-developers-own-pepper-value-0123456789");
    await import("./env-defaults");
    expect(process.env.OTP_PEPPER).toBe("a-developers-own-pepper-value-0123456789");
  });
});
