import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeProviders, readJevConfig } from "@/server/complaints/providers/config";
import { createClassifierFromEnv } from "@/server/complaints/providers/factory";
import { answerBody, FakeProvider, respondJson } from "./fake-provider";

const KEY = "test-key-not-a-secret-123";
/** Every malformed value below carries this marker, so a value that leaks into any output is found by a plain search. */
const MARK = "LEAKMARK";
const INPUT = { text: "the tap in the pantry is dripping", arm: "DIRECT" } as const;
const primary = new FakeProvider();
const secondary = new FakeProvider();
let output: string[] = [];
let warnings: string[] = [];

const valid = (): Record<string, unknown> => ({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_SECONDARY_URL: secondary.url, JEV_SECONDARY_KEY: KEY });
const asEnv = (value: Record<string, unknown>): Record<string, string | undefined> => value as Record<string, string | undefined>;

beforeAll(async () => {
  await Promise.all([primary.start(), secondary.start()]);
});
afterAll(async () => {
  await Promise.all([primary.stop(), secondary.stop()]);
});
beforeEach(() => {
  for (const fake of [primary, secondary]) {
    fake.requests.length = 0;
    fake.behaviour = respondJson(200, answerBody());
  }
  output = [];
  warnings = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

type Answer = "opencode" | "jevmodel" | null;
const LONG = "a".repeat(1_000_000);
const CASES: [string, Record<string, unknown>, Answer][] = [
  ["primary URL is http", { JEV_PRIMARY_URL: `http://${MARK}.example/x` }, "jevmodel"],
  ["primary URL is ftp", { JEV_PRIMARY_URL: `ftp://${MARK}.example/x` }, "jevmodel"],
  ["primary URL is empty", { JEV_PRIMARY_URL: "" }, "jevmodel"],
  ["primary URL is only whitespace", { JEV_PRIMARY_URL: " \t " }, "jevmodel"],
  ["primary URL is a million characters", { JEV_PRIMARY_URL: `https://${MARK}.example/${LONG}` }, "jevmodel"],
  ["primary URL is unicode", { JEV_PRIMARY_URL: `https://${MARK}-ünïcödé-日本語.example/x ✓` }, "jevmodel"],
  ["primary URL has a newline injected", { JEV_PRIMARY_URL: `https://${MARK}.example/x\nJEV_SECONDARY_KEY=stolen` }, "jevmodel"],
  ["primary URL has credentials", { JEV_PRIMARY_URL: `https://${MARK}:${MARK}@host.example/x` }, "jevmodel"],
  ["primary URL is an object stringified", { JEV_PRIMARY_URL: "[object Object]" }, "jevmodel"],
  ["primary URL is the text NaN", { JEV_PRIMARY_URL: "NaN" }, "jevmodel"],
  ["primary URL is not text at all", { JEV_PRIMARY_URL: { MARK } }, "jevmodel"],
  ["primary key is empty", { JEV_PRIMARY_KEY: "" }, "jevmodel"],
  ["primary key is only whitespace", { JEV_PRIMARY_KEY: "\n\t " }, "jevmodel"],
  ["primary key is missing and the URL is bad", { JEV_PRIMARY_KEY: undefined, JEV_PRIMARY_URL: `http://${MARK}.example` }, "jevmodel"],
  ["primary has only a key", { JEV_PRIMARY_URL: undefined }, "jevmodel"],
  ["primary has only a URL", { JEV_PRIMARY_KEY: undefined }, "jevmodel"],
  ["primary model is unicode", { JEV_PRIMARY_MODEL: `${MARK}-モデル` }, "jevmodel"],
  ["primary model has a newline", { JEV_PRIMARY_MODEL: `${MARK}\nx` }, "jevmodel"],
  ["primary model is a million characters", { JEV_PRIMARY_MODEL: `${MARK}${LONG}` }, "jevmodel"],
  ["secondary URL is http (the primary still answers)", { JEV_SECONDARY_URL: `http://${MARK}.example/x` }, "opencode"],
  ["both URLs are bad", { JEV_PRIMARY_URL: `http://${MARK}.example`, JEV_SECONDARY_URL: `ftp://${MARK}.example` }, null],
  ["one provider has only a key and the other only a URL", { JEV_PRIMARY_URL: undefined, JEV_SECONDARY_KEY: undefined }, null],
  ["both providers are not text", { JEV_PRIMARY_URL: 42, JEV_SECONDARY_URL: { MARK } }, null],
  ["timeout is not a number", { JEV_TIMEOUT_MS: `${MARK}` }, "opencode"],
  ["timeout is negative", { JEV_TIMEOUT_MS: "-5" }, "opencode"],
  ["timeout is zero", { JEV_TIMEOUT_MS: "0" }, "opencode"],
  ["timeout is NaN", { JEV_TIMEOUT_MS: "NaN" }, "opencode"],
  ["timeout is exponent or hex", { JEV_TIMEOUT_MS: "1e3" }, "opencode"],
  ["timeout is above its range", { JEV_TIMEOUT_MS: "99999999999999999999" }, "opencode"],
  ["daily cap is negative", { JEV_DAILY_CAP: "-1" }, "opencode"],
  ["daily cap is a fraction", { JEV_DAILY_CAP: "1.5" }, "opencode"],
  ["breaker failures is zero", { JEV_BREAKER_FAILURES: "0" }, "opencode"],
  ["breaker cooldown is an object stringified", { JEV_BREAKER_COOLDOWN_SECONDS: "[object Object]" }, "opencode"],
  ["every number is garbage at once", { JEV_TIMEOUT_MS: "x", JEV_DAILY_CAP: "y", JEV_BREAKER_FAILURES: "z", JEV_BREAKER_COOLDOWN_SECONDS: "w" }, "opencode"],
  ["every variable is garbage at once", { JEV_PRIMARY_URL: "x", JEV_PRIMARY_KEY: "", JEV_PRIMARY_MODEL: "a b", JEV_SECONDARY_URL: "y", JEV_SECONDARY_KEY: " ", JEV_SECONDARY_MODEL: "c d", JEV_TIMEOUT_MS: "q" }, null],
];

describe("PV11 provider settings fail soft (D145)", () => {
  it("there are at least twenty malformed environments", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(CASES)("%s", (_name, overlay, answers) => {
    const env = (): Record<string, string | undefined> => asEnv({ ...valid(), ...overlay });

    it("describeProviders and readJevConfig never throw and hold no value", () => {
      expect(() => describeProviders(env())).not.toThrow();
      expect(() => readJevConfig(env())).not.toThrow();
      expect(JSON.stringify([describeProviders(env()), readJevConfig(env()).invalidVariables])).not.toContain(MARK);
    });

    it("the factory never throws, warns by variable name only, and logs no value", async () => {
      const classifier = createClassifierFromEnv(env(), { warn: (message) => warnings.push(message) });
      for (const message of warnings) expect(message).toMatch(/^classifier setting invalid: JEV_[A-Z_]+$/);
      expect(new Set(warnings).size).toBe(warnings.length);
      await classifier.classify(INPUT);
      expect([...warnings, ...output].join("\n")).not.toContain(MARK);
      expect([...warnings, ...output].join("\n")).not.toContain(KEY);
    });

    it(answers === null ? "no provider is usable: it answers null so the keyword fallback runs, with no request sent" : `the valid provider still answers: ${answers}`, async () => {
      const result = await createClassifierFromEnv(env(), { warn: () => undefined }).classify(INPUT);
      if (answers === null) {
        expect(result).toBeNull();
        expect(primary.requests.length + secondary.requests.length).toBe(0);
      } else {
        expect(result).toMatchObject({ arm: "DIRECT", provider: answers });
        expect((answers === "opencode" ? secondary : primary).requests).toHaveLength(0);
      }
    });
  });

  it("an invalid variable is warned once per classifier, even when two of its checks fail", () => {
    createClassifierFromEnv(asEnv({ ...valid(), JEV_PRIMARY_URL: "http://x.example", JEV_PRIMARY_MODEL: "a b", JEV_TIMEOUT_MS: "x" }), { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual(["classifier setting invalid: JEV_PRIMARY_URL", "classifier setting invalid: JEV_TIMEOUT_MS"]);
  });

  it("a valid environment warns about nothing", () => {
    createClassifierFromEnv(asEnv(valid()), { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  describe("productionClassifier, built from the process environment", () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each([
      ["an http URL and garbage numbers", { JEV_PRIMARY_URL: `http://${MARK}.example`, JEV_PRIMARY_KEY: KEY, JEV_TIMEOUT_MS: MARK, JEV_DAILY_CAP: "-1" }],
      ["a key without a URL", { JEV_SECONDARY_KEY: KEY }],
      ["every variable garbage", { JEV_PRIMARY_URL: "x", JEV_PRIMARY_MODEL: "a b", JEV_SECONDARY_URL: "[object Object]", JEV_BREAKER_FAILURES: "NaN" }],
    ])("%s: it does not throw, answers null, and logs no value", async (_name, variables) => {
      for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value);
      vi.resetModules();
      const { productionClassifier } = await import("@/server/complaints/providers/factory");
      const classifier = productionClassifier();
      expect(await classifier.classify(INPUT)).toBeNull();
      expect(productionClassifier()).toBe(classifier);
      expect(output.join("\n")).not.toContain(MARK);
      for (const line of output) expect(line).toMatch(/^classifier setting invalid: JEV_[A-Z_]+$/);
    });
  });
});
