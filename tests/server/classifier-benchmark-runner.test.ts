import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BENCHMARK_ITEMS } from "@/domain/complaints/classifier-benchmark/dataset";
import type { ProviderConfig } from "@/server/complaints/providers/config";
import { FIXTURE_PATH, type Fixture, MAX_RETRIES, REQUEST_CAP, buildFixture, parseArgs, readCache, reportOf, runProvider, selectItems, startFakeProvider } from "../../scripts/classifier-benchmark";
import { FakeProvider, respondJson } from "./complaints/providers/fake-provider";

const KEY = "test-key-not-a-secret-123";
const fake = new FakeProvider();
let dir = "";
const config = (): ProviderConfig => ({ name: "opencode", url: fake.url, key: KEY });

/** A clock that only moves when the runner sleeps, so pacing and Retry-After can be asserted without waiting. */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps, lines: [] as string[] };
}

beforeAll(async () => {
  await fake.start();
  dir = mkdtempSync(path.join(tmpdir(), "benchmark-test-"));
});
afterAll(async () => {
  await fake.stop();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  fake.requests.length = 0;
  fake.behaviour = respondJson(200, { answers: {} });
});

const good = (): void => {
  fake.behaviour = async (_request, response) => {
    const { answerBody } = await import("./complaints/providers/fake-provider");
    respondJson(200, answerBody())(_request, response);
  };
};

describe("BR1 the options and the sample", () => {
  it("has defaults, and refuses a provider or a number it does not know", () => {
    expect(parseArgs([])).toEqual({ provider: "primary", limit: null, sample: null, paceMs: 1000, dryRun: false, writeFixture: false, fromFixture: false });
    expect(parseArgs(["--provider=secondary", "--limit=5", "--sample=stratified60", "--pace-ms=0", "--dry-run"])).toMatchObject({ provider: "secondary", limit: 5, sample: "stratified60", paceMs: 0, dryRun: true });
    expect(() => parseArgs(["--provider=other"])).toThrow();
    expect(() => parseArgs(["--limit=-1"])).toThrow();
    expect(() => parseArgs(["--sample=all"])).toThrow();
  });

  it("stratified60 is 3 items per cell, the same every time, in dataset order", () => {
    const a = selectItems(BENCHMARK_ITEMS, { limit: null, sample: "stratified60" });
    const b = selectItems(BENCHMARK_ITEMS, { limit: null, sample: "stratified60" });
    expect(a).toHaveLength(60);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    for (const category of ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]) for (const group of ["EN", "HI", "MR", "HINGLISH"]) expect(a.filter((i) => i.category === category && i.languageGroup === group)).toHaveLength(3);
    expect(a.map((i) => i.id)).toEqual(BENCHMARK_ITEMS.filter((i) => a.some((x) => x.id === i.id)).map((i) => i.id));
    expect(selectItems(BENCHMARK_ITEMS, { limit: 7, sample: null })).toHaveLength(7);
  });
});

describe("BR2 the run", () => {
  it("writes one line per item with the expected shape, and resume sends nothing for cached items", async () => {
    good();
    const c = clock();
    const items = BENCHMARK_ITEMS.slice(0, 4);
    const file = path.join(dir, "shape.jsonl");
    const first = await runProvider({ label: "primary", items, config: config(), timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: file }, { now: c.now, sleep: c.sleep, print: (l) => c.lines.push(l) });
    expect(first).toEqual({ requests: 4, fromCache: 0, stopped: null });
    const rows = readCache(file);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ id: items[0].id, status: 200 });
    expect(rows[0].categories).toHaveLength(5);
    expect(rows[0].urgencies).toHaveLength(3);
    expect(Object.keys(rows[0]).sort()).toEqual(["categories", "id", "latencyMs", "status", "urgencies"]);
    fake.requests.length = 0;
    const second = await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 6), config: config(), timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: file }, { now: c.now, sleep: c.sleep, print: (l) => c.lines.push(l) });
    expect(second).toMatchObject({ requests: 2, fromCache: 4 });
    expect(fake.requests).toHaveLength(2);
    expect(readCache(file)).toHaveLength(6);
  });

  it("paces the requests: at least paceMs between two", async () => {
    good();
    const c = clock();
    const times: number[] = [];
    fake.behaviour = async (request, response) => {
      times.push(c.now());
      const { answerBody } = await import("./complaints/providers/fake-provider");
      respondJson(200, answerBody())(request, response);
    };
    await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 3), config: config(), timeoutMs: 2000, paceMs: 1000, cap: 250, cacheFile: path.join(dir, "pace.jsonl") }, { now: c.now, sleep: c.sleep, print: () => undefined });
    expect(c.sleeps).toEqual([1000, 1000]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1000);
  });

  it("on 429 waits for Retry-After (at most 60 seconds), tries at most 3 more times, then stops the provider and caches nothing for that item", async () => {
    const c = clock();
    fake.behaviour = respondJson(429, {}, { "retry-after": "7" });
    const file = path.join(dir, "limited.jsonl");
    const out = await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 3), config: config(), timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: file }, { now: c.now, sleep: c.sleep, print: (l) => c.lines.push(l) });
    expect(out).toEqual({ requests: 1 + MAX_RETRIES, fromCache: 0, stopped: "rate limited at item 1" });
    expect(c.sleeps.filter((ms) => ms === 7000)).toHaveLength(MAX_RETRIES);
    expect(readCache(file)).toEqual([]);
    expect(c.lines.at(-1)).toBe("primary stopped: rate limited at item 1");
    fake.requests.length = 0;
    fake.behaviour = respondJson(429, {}, { "retry-after": "9999" });
    const c2 = clock();
    await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 1), config: config(), timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: path.join(dir, "limited2.jsonl") }, { now: c2.now, sleep: c2.sleep, print: () => undefined });
    expect(Math.max(...c2.sleeps)).toBe(60_000);
  });

  it("stops at the cap, counting every request", async () => {
    good();
    const c = clock();
    const out = await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 10), config: config(), timeoutMs: 2000, paceMs: 0, cap: 3, cacheFile: path.join(dir, "cap.jsonl") }, { now: c.now, sleep: c.sleep, print: () => undefined });
    expect(out.requests).toBe(3);
    expect(out.stopped).toBe("request cap of 3 reached at item 4");
    expect(REQUEST_CAP).toBe(250);
  });

  it("records a failure with its code, and prints no address, no Bearer and no key", async () => {
    const c = clock();
    fake.behaviour = respondJson(500, {});
    const file = path.join(dir, "fail.jsonl");
    await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 2), config: config(), timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: file }, { now: c.now, sleep: c.sleep, print: (l) => c.lines.push(l) });
    expect(readCache(file)[0]).toMatchObject({ status: 500, categories: null, urgencies: null, failure: "SERVER" });
    const everything = `${c.lines.join("\n")}\n${readFileSync(file, "utf8")}`;
    expect(everything).not.toMatch(/http|Bearer|127\.0\.0\.1/i);
    expect(everything).not.toContain(KEY);
  });
});

describe("BR3 the dry run and the report", () => {
  it("a local fake provider answers deterministically, so a dry run is repeatable and needs no network", async () => {
    const server = await startFakeProvider();
    try {
      const run = async (name: string) => {
        const c = clock();
        const file = path.join(dir, name);
        await runProvider({ label: "primary", items: BENCHMARK_ITEMS.slice(0, 5), config: { name: "opencode", url: server.url, key: "dry-run-key-not-a-secret" }, timeoutMs: 2000, paceMs: 0, cap: 250, cacheFile: file }, { now: c.now, sleep: c.sleep, print: () => undefined });
        return readCache(file).map((r) => ({ id: r.id, categories: r.categories, urgencies: r.urgencies }));
      };
      expect(await run("dry1.jsonl")).toEqual(await run("dry2.jsonl"));
    } finally {
      await server.close();
    }
  });

  it("the fixture keeps the label rows and no address, no key and no text, and the report is repeatable", () => {
    const rows = BENCHMARK_ITEMS.slice(0, 3).map((i) => ({ id: i.id, status: 200, latencyMs: 100, categories: [{ label: "PLUMBING" as const, probability: 1 }, { label: "ELECTRICAL" as const, probability: 0 }, { label: "HOUSEKEEPING" as const, probability: 0 }, { label: "LIFT" as const, probability: 0 }, { label: "OTHER" as const, probability: 0 }], urgencies: [{ label: "NORMAL" as const, probability: 1 }, { label: "HIGH" as const, probability: 0 }, { label: "LOW" as const, probability: 0 }] }));
    const fixture = buildFixture((label) => (label === "primary" ? rows : []));
    expect(Object.keys(fixture.providers)).toEqual(["primary"]);
    const text = JSON.stringify(fixture);
    for (const item of BENCHMARK_ITEMS.slice(0, 3)) expect(text).not.toContain(item.text);
    expect(text).not.toMatch(/https?:|Bearer/);
    expect(reportOf(fixture)).toBe(reportOf(fixture));
    expect(reportOf(fixture)).toContain("### primary (3 items)");
    expect(reportOf({ note: "", providers: {} })).toBe("No results.");
  });
});

describe("BR4 the committed results and the document", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

  it("the fixture has no address, no key and no complaint text, and only the compact fields", () => {
    const text = readFileSync(FIXTURE_PATH, "utf8");
    expect(text).not.toMatch(/https?:|Bearer/);
    for (const item of BENCHMARK_ITEMS) expect(text.includes(item.text), item.id).toBe(false);
    for (const rows of Object.values(fixture.providers)) for (const row of rows ?? []) expect(Object.keys(row).every((k) => ["id", "status", "latencyMs", "categories", "urgencies", "failure"].includes(k))).toBe(true);
  });

  it("--from-fixture recomputes EXACTLY the numbers printed in docs/classifier-benchmark.md", () => {
    const doc = readFileSync("docs/classifier-benchmark.md", "utf8");
    const printed = /<!-- RESULTS:START -->\n([\s\S]*?)\n<!-- RESULTS:END -->/.exec(doc)?.[1];
    expect(printed).toBe(reportOf(fixture));
  });

  it("the cache folder is ignored by git, and no cache file is committed", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\.cache\/$/m);
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });
});
