// The classifier benchmark runner (D86):  npm run classifier:benchmark -- --provider=primary
// Sends the synthetic dataset (src/domain/complaints/classifier-benchmark) to ONE provider through the repository's own client and request builder, at most one request
// per --pace-ms, caches every answer line by line in .cache/classifier-benchmark/<provider>.jsonl (a rerun resumes and never repeats a call), and stops a provider that
// keeps answering 429. It never prints a key or an address and never logs a request or a response body; it keeps only the provider label, the item id, the status, the
// latency, the validated distributions and a failure code.
//   --provider=primary|secondary   (default primary)
//   --prompt=v1|v2                 the request text (default v1); the cache of each provider and version is kept apart (D197)
//   --cap=N                        the most requests of one run (default 250, retries included)
//   --limit=N                      the first N items
//   --sample=stratified60          3 items per cell, chosen with the fixed seed 42
//   --pace-ms=1000                 the least time between two requests
//   --dry-run                      a local fake provider answers (no network, no key)
//   --write-fixture                write the compact results of the caches to tests/fixtures/classifier-benchmark/results.json (results-v2.json with --prompt=v2)
//   --from-fixture                 recompute and print the numbers from the fixtures (v1, the same-day detector block, and v1 against v2 when results-v2.json exists), with no network
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BENCHMARK_ITEMS, type BenchmarkItem } from "../src/domain/complaints/classifier-benchmark/dataset";
import { type ItemResult, evaluate } from "../src/domain/complaints/classifier-benchmark/evaluate";
import { scoreItems } from "../src/domain/complaints/classifier-benchmark/binary-high";
import { formatBinaryHigh } from "../src/domain/complaints/classifier-benchmark/binary-high-report";
import { formatComparison } from "../src/domain/complaints/classifier-benchmark/compare";
import { formatProvider } from "../src/domain/complaints/classifier-benchmark/report";
import { createRng } from "../src/domain/complaints/safety-benchmark/prng";
import { JevClient } from "../src/server/complaints/providers/client";
import { type ProviderConfig, readJevConfig } from "../src/server/complaints/providers/config";
import type { PromptVersion } from "../src/server/complaints/providers/system-one";

export const REQUEST_CAP = 250;
export const MAX_RETRIES = 3;
export const MAX_RETRY_AFTER_SECONDS = 60;
export const FIXTURE_PATH = path.join("tests", "fixtures", "classifier-benchmark", "results.json");
export const FIXTURE_V2_PATH = path.join("tests", "fixtures", "classifier-benchmark", "results-v2.json");
export const CACHE_DIR = path.join(".cache", "classifier-benchmark");

export type Label = "primary" | "secondary";
export type Options = { provider: Label; prompt: PromptVersion; cap: number; limit: number | null; sample: "stratified60" | null; paceMs: number; dryRun: boolean; writeFixture: boolean; fromFixture: boolean };

export function parseArgs(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const provider = value("provider") ?? "primary";
  if (provider !== "primary" && provider !== "secondary") throw new Error("--provider must be primary or secondary");
  const prompt = value("prompt") ?? "v1";
  if (prompt !== "v1" && prompt !== "v2") throw new Error("--prompt must be v1 or v2");
  const sample = value("sample");
  if (sample !== undefined && sample !== "stratified60") throw new Error("--sample must be stratified60");
  const number = (name: string, fallback: number | null): number | null => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  return { provider, prompt, cap: number("cap", REQUEST_CAP) ?? REQUEST_CAP, limit: number("limit", null), sample: sample ?? null, paceMs: number("pace-ms", 1000) ?? 1000, dryRun: argv.includes("--dry-run"), writeFixture: argv.includes("--write-fixture"), fromFixture: argv.includes("--from-fixture") };
}

/** The items to send: the whole set, or 3 per (category, language group) cell with seed 42, in a seeded shuffle (seed 42) so that a partial run is a fair sample, then at most `limit`. */
export function selectItems(items: readonly BenchmarkItem[], options: Pick<Options, "limit" | "sample">): BenchmarkItem[] {
  let chosen: BenchmarkItem[] = [...items];
  if (options.sample === "stratified60") {
    const rng = createRng(42);
    const keep = new Set<string>();
    const cells = new Map<string, BenchmarkItem[]>();
    for (const item of items) cells.set(`${item.category}/${item.languageGroup}`, [...(cells.get(`${item.category}/${item.languageGroup}`) ?? []), item]);
    for (const cell of cells.values()) for (const item of rng.shuffle(cell).slice(0, 3)) keep.add(item.id);
    chosen = chosen.filter((i) => keep.has(i.id));
  }
  chosen = createRng(42).shuffle(chosen);
  return options.limit === null ? chosen : chosen.slice(0, options.limit);
}

/** The cache file of a provider and prompt version: `<provider>-<version>.jsonl`. The v1 cache written before the versions existed (`<provider>.jsonl`) is used while the new name is absent. */
export function cacheFileFor(label: Label, version: PromptVersion, dryRun = false): string {
  const prefix = dryRun ? "dry-run-" : "";
  const named = path.join(CACHE_DIR, `${prefix}${label}-${version}.jsonl`);
  const legacy = path.join(CACHE_DIR, `${prefix}${label}.jsonl`);
  return version === "v1" && !existsSync(named) && existsSync(legacy) ? legacy : named;
}

export function readCache(file: string): ItemResult[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as ItemResult);
}

export type RunDeps = { now: () => number; sleep: (ms: number) => Promise<void>; print: (line: string) => void; fetch?: typeof fetch };
export type RunInput = { label: Label; prompt?: PromptVersion; items: readonly BenchmarkItem[]; config: ProviderConfig; timeoutMs: number; paceMs: number; cap: number; cacheFile: string };
export type RunSummary = { requests: number; fromCache: number; stopped: string | null };

/**
 * Sends the items that are not in the cache yet, one at a time. Pacing: at least `paceMs` between two requests. A 429 waits for Retry-After (at most 60 seconds) and
 * tries again, at most 3 times; a provider that still says 429 is stopped ("rate limited at item k"). The cap counts every request, retries included.
 */
export async function runProvider(input: RunInput, deps: RunDeps): Promise<RunSummary> {
  const cached = new Map(readCache(input.cacheFile).map((r) => [r.id, r]));
  mkdirSync(path.dirname(input.cacheFile), { recursive: true });
  const client = new JevClient(input.config, { fetch: deps.fetch, now: deps.now, promptVersion: input.prompt });
  let requests = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  let stopped: string | null = null;
  const todo = input.items.filter((i) => !cached.has(i.id));
  for (const [index, item] of todo.entries()) {
    let outcome;
    for (let attempt = 0; ; attempt++) {
      if (requests >= input.cap) {
        stopped = `request cap of ${input.cap} reached at item ${index + 1}`;
        break;
      }
      const wait = lastAt + input.paceMs - deps.now();
      if (wait > 0) await deps.sleep(wait);
      lastAt = deps.now();
      requests += 1;
      outcome = await client.call(item.text, { timeoutMs: input.timeoutMs });
      if (outcome.ok || outcome.failure !== "RATE_LIMITED") break;
      if (attempt >= MAX_RETRIES) {
        stopped = `rate limited at item ${index + 1}`;
        break;
      }
      await deps.sleep(1000 * Math.min(outcome.retryAfterSeconds ?? 5, MAX_RETRY_AFTER_SECONDS));
    }
    if (stopped !== null || outcome === undefined) break;
    const row: ItemResult = outcome.ok
      ? { id: item.id, status: outcome.status, latencyMs: outcome.latencyMs, categories: outcome.value.categories, urgencies: outcome.value.urgencies }
      : { id: item.id, status: outcome.status ?? null, latencyMs: outcome.latencyMs, categories: null, urgencies: null, failure: outcome.failure };
    appendFileSync(input.cacheFile, `${JSON.stringify(row)}\n`);
    deps.print(`${input.label} item ${cached.size + index + 1}/${input.items.length} ${item.id} status ${row.status ?? "none"} ${row.latencyMs} ms${row.failure === undefined ? "" : ` failed ${row.failure}`}`);
  }
  if (stopped !== null) deps.print(`${input.label} stopped: ${stopped}`);
  return { requests, fromCache: input.items.length - todo.length, stopped };
}

export type Fixture = { note: string; providers: Partial<Record<Label, ItemResult[]>> };

export function buildFixture(read: (label: Label) => ItemResult[]): Fixture {
  const providers: Fixture["providers"] = {};
  for (const label of ["primary", "secondary"] as const) {
    const rows = read(label);
    if (rows.length > 0) providers[label] = rows;
  }
  return { note: "Compact results of the classifier benchmark: the provider label, the item id, the status, the latency and the validated distributions. No address, no key, no complaint text.", providers };
}

/** The Markdown of every provider in a fixture: what `--from-fixture` prints and what docs/classifier-benchmark.md contains between its markers. */
export function reportOf(fixture: Fixture, items: readonly BenchmarkItem[] = BENCHMARK_ITEMS): string {
  const parts = (["primary", "secondary"] as const).flatMap((label) => {
    const results = fixture.providers[label];
    return results === undefined ? [] : [formatProvider(label, evaluate({ items, results }))];
  });
  return parts.length === 0 ? "No results." : parts.join("\n\n");
}

/** A local fake System One provider for --dry-run: it answers every request with a distribution worked out from the text, so a dry run is repeatable. */
export async function startFakeProvider(): Promise<{ url: string; close: () => Promise<void> }> {
  const categories = ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const state = String((JSON.parse(raw) as { state?: string }).state ?? "");
      const pick = [...state].reduce((sum, c) => sum + c.charCodeAt(0), 0) % categories.length;
      const probabilities = Object.fromEntries(categories.map((c, i) => [c, i === pick ? 0.9 : 0.025]));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ answers: { category: { type: "choice", choice: categories[pick], probabilities }, urgency: { type: "choice", choice: "NORMAL", probabilities: { HIGH: 0.1, NORMAL: 0.8, LOW: 0.1 } } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/v1/systemone`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const print = (line: string): void => console.log(line);
  if (options.fromFixture) {
    const v1 = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
    print(reportOf(v1));
    print(`\n${formatBinaryHigh(scoreItems({ items: BENCHMARK_ITEMS, results: v1.providers.primary ?? [] }))}`);
    if (existsSync(FIXTURE_V2_PATH)) {
      const v2 = JSON.parse(readFileSync(FIXTURE_V2_PATH, "utf8")) as Fixture;
      print(`\n${formatComparison({ items: BENCHMARK_ITEMS, v1: v1.providers.primary ?? [], v2: v2.providers.primary ?? [] })}`);
    }
    return 0;
  }
  if (options.writeFixture) {
    const fixture = buildFixture((label) => readCache(cacheFileFor(label, options.prompt)));
    const target = options.prompt === "v2" ? FIXTURE_V2_PATH : FIXTURE_PATH;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(fixture)}\n`);
    print(`wrote the fixture: ${Object.entries(fixture.providers).map(([label, rows]) => `${label} ${rows?.length ?? 0} items`).join(", ")}`);
    return 0;
  }
  let env: Record<string, string | undefined> = process.env;
  let fake: Awaited<ReturnType<typeof startFakeProvider>> | null = null;
  if (options.dryRun) {
    fake = await startFakeProvider();
    env = { JEV_PRIMARY_URL: fake.url, JEV_PRIMARY_KEY: "dry-run-key-not-a-secret", JEV_SECONDARY_URL: fake.url, JEV_SECONDARY_KEY: "dry-run-key-not-a-secret" };
  } else {
    try {
      process.loadEnvFile();
    } catch {
      // No .env: the variables may come from the shell.
    }
    env = process.env;
  }
  try {
    const config = readJevConfig(env);
    const wanted = options.provider === "primary" ? "opencode" : "jevmodel";
    const provider = config.providers.find((p) => p.name === wanted);
    if (provider === undefined) {
      print(`${options.provider}: not configured, nothing was sent`);
      return 1;
    }
    const items = selectItems(BENCHMARK_ITEMS, options);
    const cacheFile = cacheFileFor(options.provider, options.prompt, options.dryRun);
    const summary = await runProvider({ label: options.provider, prompt: options.prompt, items, config: provider, timeoutMs: config.timeoutMs, paceMs: options.paceMs, cap: options.cap, cacheFile }, { now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), print });
    print(`${options.provider}: ${summary.requests} requests sent, ${summary.fromCache} items already cached${summary.stopped === null ? "" : `, stopped: ${summary.stopped}`}`);
    const results = readCache(cacheFile).filter((r) => items.some((i) => i.id === r.id));
    print(reportOf({ note: "", providers: { [options.provider]: results } }, BENCHMARK_ITEMS.filter((i) => items.some((s) => s.id === i.id))));
    return summary.stopped === null ? 0 : 2;
  } finally {
    await fake?.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
