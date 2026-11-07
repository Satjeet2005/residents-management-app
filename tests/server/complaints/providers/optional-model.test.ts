import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../../../../scripts/llm-check";
import { JevClient } from "@/server/complaints/providers/client";
import { describeProviders, readJevConfig } from "@/server/complaints/providers/config";
import { createClassifierFromEnv } from "@/server/complaints/providers/factory";
import { buildRequest, parseResponse } from "@/server/complaints/providers/system-one";
import { answerBody, FakeProvider, respondJson } from "./fake-provider";

const KEY = "test-key-not-a-secret-123";
const MODEL_VALUE = "very-recognisable-model-name";
const INPUT = { text: "the tap in the pantry is dripping", arm: "DIRECT" } as const;
const primary = new FakeProvider();
const secondary = new FakeProvider();
let output: string[] = [];

const urls = () => ({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_SECONDARY_URL: secondary.url, JEV_SECONDARY_KEY: KEY });
const keysOf = (fake: FakeProvider): string[] => Object.keys(fake.requests[0].body as object).sort();

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
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("PV10 the model name is optional (D144)", () => {
  describe("configuration", () => {
    it("URL and key are enough: configured, with no model key at all", () => {
      const [provider] = readJevConfig({ JEV_PRIMARY_URL: "https://primary.example/x", JEV_PRIMARY_KEY: KEY }).providers;
      expect(provider).toEqual({ name: "opencode", url: "https://primary.example/x", key: KEY });
      expect("model" in provider).toBe(false);
    });

    it("a set model is trimmed and kept", () => {
      const [provider] = readJevConfig({ JEV_PRIMARY_URL: "https://primary.example/x", JEV_PRIMARY_KEY: KEY, JEV_PRIMARY_MODEL: "  jev-1.14.0  " }).providers;
      expect(provider.model).toBe("jev-1.14.0");
    });

    it("describeProviders says configured, and whether the model is set or the provider default", () => {
      const env = { ...urls(), JEV_SECONDARY_MODEL: "org/model:v1_2.3-x" };
      expect(describeProviders(env)).toEqual([
        { name: "opencode", status: "configured", model: "provider_default" },
        { name: "jevmodel", status: "configured", model: "set" },
      ]);
    });

    it("a model without a URL and key is not configured", () => {
      expect(describeProviders({ JEV_PRIMARY_MODEL: "m" })[0]).toEqual({ name: "opencode", status: "not_configured", model: "set" });
    });

    it.each(["has space", "x".repeat(81), "semi;colon", "quote\"d", "new\nline", "back\\slash", "ünïcode"])("model %j is invalid: BAD_MODEL on that provider only", (model) => {
      const env = { ...urls(), JEV_PRIMARY_MODEL: model };
      expect(describeProviders(env)).toEqual([
        { name: "opencode", status: "invalid", model: "set", invalid: { variable: "JEV_PRIMARY_MODEL", reason: "BAD_MODEL" } },
        { name: "jevmodel", status: "configured", model: "provider_default" },
      ]);
      expect(readJevConfig(env).providers.map((p) => p.name)).toEqual(["jevmodel"]);
    });

    it.each(["a", "x".repeat(80), "jev-latest", "a.b_c-d/e:f"])("model %j is valid", (model) => {
      expect(readJevConfig({ ...urls(), JEV_PRIMARY_MODEL: model }).providers[0].model).toBe(model);
    });
  });

  describe("the request body", () => {
    it("without a model the body has exactly state and questions, and the raw JSON has no model", () => {
      const request = buildRequest("a leak");
      expect(Object.keys(request).sort()).toEqual(["questions", "state"]);
      expect(JSON.stringify(request)).not.toContain("model");
    });

    it("with a model the body has exactly model, state and questions", () => {
      expect(Object.keys(buildRequest("a leak", "jev-latest")).sort()).toEqual(["model", "questions", "state"]);
    });

    it("the client sends no model key when none is set, and never an empty or null one", async () => {
      await new JevClient({ name: "opencode", url: primary.url, key: KEY }).call("a leak", { timeoutMs: 1000 });
      expect(keysOf(primary)).toEqual(["questions", "state"]);
      expect(primary.requests[0].raw).not.toMatch(/"model"/);
    });

    it("the client sends the model when it is set", async () => {
      await new JevClient({ name: "opencode", url: primary.url, key: KEY, model: "jev-latest" }).call("a leak", { timeoutMs: 1000 });
      expect(keysOf(primary)).toEqual(["model", "questions", "state"]);
      expect((primary.requests[0].body as { model: string }).model).toBe("jev-latest");
    });
  });

  it("the response parser does not need a model field in the answer", () => {
    const withoutModel = { ...(answerBody() as Record<string, unknown>) };
    delete withoutModel.model;
    expect("model" in withoutModel).toBe(false);
    expect(parseResponse(withoutModel)).not.toBeNull();
  });

  describe("providers in a chain", () => {
    it("an invalid model leaves out only that provider: the other answers, and only the variable name is warned, once", async () => {
      const classifier = createClassifierFromEnv({ ...urls(), JEV_PRIMARY_MODEL: `bad ${MODEL_VALUE}` });
      expect(await classifier.classify(INPUT)).toMatchObject({ provider: "jevmodel" });
      expect(primary.requests).toHaveLength(0);
      const warnings = output.filter((line) => line.includes("JEV_PRIMARY_MODEL"));
      expect(warnings).toEqual(["classifier provider setting is invalid: variable=JEV_PRIMARY_MODEL reason=BAD_MODEL"]);
      await classifier.classify(INPUT);
      expect(output.filter((line) => line.includes("JEV_PRIMARY_MODEL"))).toHaveLength(1);
    });

    it("an invalid model on the only provider means no provider: the keyword fallback runs", async () => {
      const classifier = createClassifierFromEnv({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_PRIMARY_MODEL: "bad name" });
      expect(await classifier.classify(INPUT)).toBeNull();
      expect(primary.requests).toHaveLength(0);
    });

    it("failover works with the primary's model unset and the secondary's set", async () => {
      primary.behaviour = respondJson(500, {});
      const classifier = createClassifierFromEnv({ ...urls(), JEV_SECONDARY_MODEL: "jev-latest" });
      expect(await classifier.classify(INPUT)).toMatchObject({ provider: "jevmodel" });
      expect(keysOf(primary)).toEqual(["questions", "state"]);
      expect(keysOf(secondary)).toEqual(["model", "questions", "state"]);
    });

    it("failover works the other way round: the primary's model set, the secondary's unset", async () => {
      primary.behaviour = respondJson(429, {}, { "retry-after": "1" });
      const classifier = createClassifierFromEnv({ ...urls(), JEV_PRIMARY_MODEL: "jev-latest" });
      expect(await classifier.classify(INPUT)).toMatchObject({ provider: "jevmodel" });
      expect(keysOf(primary)).toEqual(["model", "questions", "state"]);
      expect(keysOf(secondary)).toEqual(["questions", "state"]);
    });

    it("the log never contains a model value, for a failure or for an invalid name", async () => {
      primary.behaviour = respondJson(500, {});
      await createClassifierFromEnv({ ...urls(), JEV_PRIMARY_MODEL: MODEL_VALUE }).classify(INPUT);
      createClassifierFromEnv({ ...urls(), JEV_SECONDARY_MODEL: `bad ${MODEL_VALUE}` });
      expect(output.some((line) => line.includes("classifier provider"))).toBe(true);
      expect(output.join("\n")).not.toContain(MODEL_VALUE);
    });
  });

  describe("llm:check", () => {
    const run = async (env: Record<string, string | undefined>) => {
      const lines: string[] = [];
      const code = await runCheck(env, (line) => lines.push(line));
      return { code, output: lines.join("\n") };
    };
    const hint = "this provider may require a model name: set JEV_PRIMARY_MODEL";

    it("prints 'model: provider default' when unset and 'model: set' (never the value) when set", async () => {
      const unset = await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY });
      expect(unset.output).toContain("opencode  model: provider default");
      const set = await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_PRIMARY_MODEL: MODEL_VALUE });
      expect(set.output).toContain("opencode  model: set");
      expect(set.output).not.toContain(MODEL_VALUE);
    });

    it.each([400, 422])("HTTP %i with no model set adds the hint, derived from the status only", async (status) => {
      primary.behaviour = respondJson(status, { detail: "body-text-that-must-not-leak model required" });
      const { output: text } = await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY });
      expect(text.split("\n").filter((line) => line.includes(hint))).toHaveLength(1);
      expect(text).not.toContain("body-text-that-must-not-leak");
    });

    it("HTTP 400 with a model set adds no hint, and HTTP 500 with none set adds none", async () => {
      primary.behaviour = respondJson(400, {});
      expect((await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_PRIMARY_MODEL: "m" })).output).not.toContain("may require a model name");
      primary.behaviour = respondJson(500, {});
      expect((await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY })).output).not.toContain("may require a model name");
    });

    it("an invalid model is reported as BAD_MODEL by variable name, without the value", async () => {
      const { code, output: text } = await run({ JEV_PRIMARY_URL: primary.url, JEV_PRIMARY_KEY: KEY, JEV_PRIMARY_MODEL: `bad ${MODEL_VALUE}` });
      expect(code).toBe(1);
      expect(text).toContain("opencode: not checked, JEV_PRIMARY_MODEL is not valid (BAD_MODEL).");
      expect(text).not.toContain(MODEL_VALUE);
    });

    it("with no key set the output names the URL and key variables and checks nothing", async () => {
      const { code, output: text } = await run({});
      expect(code).toBe(1);
      expect(text).toContain("opencode: not checked, JEV_PRIMARY_URL, JEV_PRIMARY_KEY are not set.");
      expect(text).toContain("jevmodel: not checked, JEV_SECONDARY_URL, JEV_SECONDARY_KEY are not set.");
    });
  });
});
