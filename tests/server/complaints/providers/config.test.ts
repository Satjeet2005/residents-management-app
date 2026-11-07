import { describe, expect, it } from "vitest";
import { readJevConfig } from "@/server/complaints/providers/config";

const FULL = {
  JEV_PRIMARY_URL: "https://primary.example/v1/systemone",
  JEV_PRIMARY_MODEL: "jev-latest",
  JEV_PRIMARY_KEY: "key-primary-000",
  JEV_SECONDARY_URL: "https://secondary.example/api/v1/systemone",
  JEV_SECONDARY_MODEL: "jev-1.14.0",
  JEV_SECONDARY_KEY: "key-secondary-000",
};

describe("PV1 provider configuration", () => {
  it("nothing set: no provider, the documented defaults", () => {
    expect(readJevConfig({})).toEqual({ providers: [], timeoutMs: 3000, dailyCap: 300, breakerFailures: 3, breakerCooldownSeconds: 120 });
  });

  it("both providers complete: primary first, named opencode and jevmodel", () => {
    const config = readJevConfig(FULL);
    expect(config.providers.map((p) => p.name)).toEqual(["opencode", "jevmodel"]);
    expect(config.providers[0]).toEqual({ name: "opencode", url: "https://primary.example/v1/systemone", model: "jev-latest", key: "key-primary-000" });
  });

  it.each(["URL", "KEY"])("a provider with its %s missing is not configured", (part) => {
    const env: Record<string, string | undefined> = { ...FULL };
    delete env[`JEV_PRIMARY_${part}`];
    expect(readJevConfig(env).providers.map((p) => p.name)).toEqual(["jevmodel"]);
  });

  it("blank values count as missing", () => {
    expect(readJevConfig({ ...FULL, JEV_PRIMARY_KEY: "   ", JEV_SECONDARY_URL: "" }).providers).toEqual([]);
  });

  it("only the secondary configured is allowed", () => {
    const secondaryOnly = { JEV_SECONDARY_URL: FULL.JEV_SECONDARY_URL, JEV_SECONDARY_MODEL: FULL.JEV_SECONDARY_MODEL, JEV_SECONDARY_KEY: FULL.JEV_SECONDARY_KEY };
    expect(readJevConfig(secondaryOnly).providers.map((p) => p.name)).toEqual(["jevmodel"]);
  });

  describe("the https rule", () => {
    it.each(["http://primary.example/x", "ftp://primary.example/x", "not a url", "//primary.example", "https://user:pw@primary.example/x"])("%s throws a RangeError", (url) => {
      expect(() => readJevConfig({ ...FULL, JEV_PRIMARY_URL: url })).toThrow(RangeError);
    });

    it.each(["http://127.0.0.1:8080/v1/systemone", "http://localhost:3000/x"])("%s is allowed for tests", (url) => {
      expect(readJevConfig({ ...FULL, JEV_PRIMARY_URL: url }).providers[0]?.url).toBe(url);
    });

    it("an invalid URL throws even when the provider is otherwise partial, and the message holds neither the URL nor a key", () => {
      const env = { JEV_SECONDARY_URL: "http://secret-host.example/path", JEV_SECONDARY_KEY: "key-secondary-000" };
      expect(() => readJevConfig(env)).toThrow(RangeError);
      try {
        readJevConfig(env);
      } catch (error) {
        expect(String((error as Error).message)).not.toContain("secret-host");
        expect(String((error as Error).message)).not.toContain("key-secondary");
      }
    });
  });

  describe("ranges", () => {
    it.each([
      ["JEV_TIMEOUT_MS", ["499", "4001", "abc", "1.5", "-1", "3e3"], ["500", "4000"]],
      ["JEV_DAILY_CAP", ["0", "100001", "x"], ["1", "100000"]],
      ["JEV_BREAKER_FAILURES", ["0", "21"], ["1", "20"]],
      ["JEV_BREAKER_COOLDOWN_SECONDS", ["0", "3601"], ["1", "3600"]],
    ] as const)("%s", (name, bad, good) => {
      for (const value of bad) expect(() => readJevConfig({ [name]: value }), `${name}=${value}`).toThrow(RangeError);
      for (const value of good) expect(() => readJevConfig({ [name]: value })).not.toThrow();
    });

    it("values are read", () => {
      expect(readJevConfig({ JEV_TIMEOUT_MS: "1200", JEV_DAILY_CAP: "50", JEV_BREAKER_FAILURES: "5", JEV_BREAKER_COOLDOWN_SECONDS: "30" })).toMatchObject({ timeoutMs: 1200, dailyCap: 50, breakerFailures: 5, breakerCooldownSeconds: 30 });
    });
  });

  it("an invalid model name leaves that provider out, it does not throw", () => {
    expect(readJevConfig({ ...FULL, JEV_PRIMARY_MODEL: "jev latest" }).providers.map((p) => p.name)).toEqual(["jevmodel"]);
    expect(readJevConfig({ ...FULL, JEV_PRIMARY_MODEL: "x".repeat(81) }).providers.map((p) => p.name)).toEqual(["jevmodel"]);
  });
});
