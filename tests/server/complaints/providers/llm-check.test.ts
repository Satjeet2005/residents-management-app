import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCheck, SAMPLES } from "../../../../scripts/llm-check";
import { answerBody, FakeProvider, respondJson } from "./fake-provider";

const KEY = "test-key-not-a-secret-123";
const fake = new FakeProvider();

async function run(env: Record<string, string | undefined>): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const code = await runCheck(env, (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}
const primaryEnv = () => ({ JEV_PRIMARY_URL: fake.url, JEV_PRIMARY_MODEL: "jev-latest", JEV_PRIMARY_KEY: KEY });

beforeAll(async () => {
  await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => {
  fake.requests.length = 0;
  fake.behaviour = respondJson(200, answerBody());
});

describe("llm:check", () => {
  it("prints one line per sample with the provider, status, latency, top category and urgency, and exits 0", async () => {
    const { code, output } = await run(primaryEnv());
    expect(code).toBe(0);
    expect(fake.requests.map((r) => (r.body as { state: string }).state)).toEqual([...SAMPLES]);
    const lines = output.split("\n").filter((l) => l.startsWith("opencode  sample"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^opencode {2}sample 1 {2}HTTP 200 {2}\d+ ms {2}category PLUMBING 0\.90 {2}urgency NORMAL 0\.80$/);
    expect(output).toContain("jevmodel: not checked, JEV_SECONDARY_URL, JEV_SECONDARY_KEY are not set.");
  });

  it("never prints the key, the URL or a response body", async () => {
    fake.behaviour = respondJson(401, { detail: "secret-body-text" });
    const { output } = await run(primaryEnv());
    expect(output).not.toContain(KEY);
    expect(output).not.toContain(fake.url);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-body-text");
  });

  it("every configured provider failing exits 1", async () => {
    fake.behaviour = respondJson(401, {});
    const { code, output } = await run(primaryEnv());
    expect(code).toBe(1);
    expect(output).toContain("HTTP 401");
    expect(output).toContain("Every configured provider failed.");
  });

  it("a provider that answers keeps the exit at 0 even when the other failed", async () => {
    const other = await new FakeProvider().start();
    other.behaviour = respondJson(500, {});
    const env = { ...primaryEnv(), JEV_SECONDARY_URL: other.url, JEV_SECONDARY_MODEL: "m", JEV_SECONDARY_KEY: KEY };
    const { code, output } = await run(env);
    await other.stop();
    expect(code).toBe(0);
    expect(output).toContain("jevmodel  sample 1  HTTP 500");
    expect(output).toContain("1 of 2 configured provider(s) answered.");
  });

  it("a missing key is said in a sentence, nothing is sent, and the exit is 1", async () => {
    const { code, output } = await run({ JEV_PRIMARY_URL: fake.url, JEV_PRIMARY_MODEL: "jev-latest" });
    expect(code).toBe(1);
    expect(output).toContain("opencode: invalid (MISSING_KEY), not checked: look at JEV_PRIMARY_KEY");
    expect(output).toContain("No provider is configured");
    expect(fake.requests).toHaveLength(0);
  });

  it("an invalid number is named, never its value, and the check still runs with the default", async () => {
    const { code, output } = await run({ ...primaryEnv(), JEV_TIMEOUT_MS: "99999" });
    expect(code).toBe(0);
    expect(output).toContain("JEV_TIMEOUT_MS is not valid, so its default is used.");
    expect(output).toContain("shared settings: timeout invalid, using the default, cap default, breaker default.");
    expect(output).not.toContain("99999");
  });

  it("an invalid URL is named by variable and reason, never its value, and exits 1", async () => {
    const { code, output } = await run({ JEV_PRIMARY_URL: "http://secret-host.example/x", JEV_PRIMARY_KEY: KEY });
    expect(code).toBe(1);
    expect(output).toContain("opencode: invalid (URL_NOT_HTTPS), not checked: look at JEV_PRIMARY_URL");
    expect(output).not.toContain("secret-host");
  });
});
