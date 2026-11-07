import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SW_PATH = path.resolve(process.cwd(), "public/sw.js");
const source = readFileSync(SW_PATH, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
const ORIGIN = "https://township.example";
const ALLOWED = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"];

type Listener = (event: unknown) => void;
type FakeRequest = { url: string; method: string; mode: string };

/** Runs sw.js in a sandbox with a recording cache, and returns what it did. */
function loadWorker(online: boolean) {
  const listeners: Record<string, Listener> = {};
  const writes: string[] = [];
  const deleted: string[] = [];
  const fetched: string[] = [];
  const stores = new Map<string, Map<string, string>>([["township-public-v0", new Map()], ["other-app", new Map()]]);
  const cacheApi = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, string>();
      stores.set(name, store);
      return {
        addAll: async (requests: FakeRequest[]) => {
          for (const r of requests) {
            writes.push(`addAll ${new URL(r.url, ORIGIN).pathname} credentials=${(r as unknown as { credentials: string }).credentials}`);
            store.set(new URL(r.url, ORIGIN).pathname, "cached");
          }
        },
        put: async (key: unknown) => {
          writes.push(`put ${String(key)}`);
        },
        add: async (key: unknown) => {
          writes.push(`add ${String(key)}`);
        },
      };
    },
    match: async (key: string) => (stores.get("township-public-v1")?.has(key) ? `cached:${key}` : undefined),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => {
      deleted.push(name);
      stores.delete(name);
      return true;
    },
  };
  class FakeRequestClass {
    url: string;
    credentials: string;
    constructor(path: string, init: { credentials?: string } = {}) {
      this.url = new URL(path, ORIGIN).toString();
      this.credentials = init.credentials ?? "same-origin";
    }
  }
  const sandbox = {
    self: { addEventListener: (type: string, fn: Listener) => (listeners[type] = fn), location: { origin: ORIGIN }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } },
    caches: cacheApi,
    Request: FakeRequestClass,
    URL,
    Promise,
    fetch: async (request: FakeRequest) => {
      fetched.push(request.url);
      if (!online) throw new Error("offline");
      return "network-response";
    },
  };
  vm.runInNewContext(source, sandbox);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let answer: Promise<unknown> | undefined;
    await listeners[type]({ ...event, respondWith: (p: Promise<unknown>) => (answer = p), waitUntil: (p: Promise<unknown>) => (answer = p) });
    return answer === undefined ? undefined : await answer;
  };
  const request = (pathname: string, init: Partial<FakeRequest> = {}): FakeRequest => ({ url: ORIGIN + pathname, method: "GET", mode: "cors", ...init });
  return { fire, writes, deleted, fetched, request };
}

describe("T15 the service worker keeps only public files (sw.js)", () => {
  it("has no cache.put, no cache.add of a request and no mention of /api, and lists exactly the allowed public files, all of which exist", () => {
    expect(code).not.toMatch(/\.put\(/);
    expect(code).not.toMatch(/\.add\(/);
    expect(code).not.toContain("/api");
    const listed = [...(/const PUBLIC = \[([^\]]*)\]/.exec(source)?.[1].matchAll(/"(\/[^"]+)"/g) ?? [])].map((m) => m[1]);
    expect(listed).toEqual(ALLOWED.slice(1));
    expect(source).toContain('const OFFLINE_PAGE = "/offline.html"');
    for (const file of ALLOWED) expect(existsSync(path.resolve(process.cwd(), "public", file.slice(1))), file).toBe(true);
  });

  it("has a version constant, and an activate handler that deletes the caches of other versions", async () => {
    expect(source).toMatch(/const VERSION = "v\d+"/);
    const worker = loadWorker(true);
    await worker.fire("activate", {});
    expect(worker.deleted.sort()).toEqual(["other-app", "township-public-v0"]);
  });

  it("at install it stores only the allowed files, fetched without credentials", async () => {
    const worker = loadWorker(true);
    await worker.fire("install", {});
    expect(worker.writes).toEqual(ALLOWED.map((p) => `addAll ${p} credentials=omit`));
  });

  it.each(["/api/me", "/api/payments", "/api/complaints", "/staff/reports", "/", "/_next/data/x.json"])("a GET of %s that is not a navigation is left to the browser and never stored", async (pathname) => {
    const worker = loadWorker(true);
    const answer = await worker.fire("fetch", { request: worker.request(pathname) });
    expect(answer).toBeUndefined();
    expect(worker.writes).toEqual([]);
  });

  it("a POST (a payment, a Server Action) is left to the browser", async () => {
    const worker = loadWorker(true);
    expect(await worker.fire("fetch", { request: worker.request("/api/payments", { method: "POST" }) })).toBeUndefined();
    expect(await worker.fire("fetch", { request: worker.request("/", { method: "POST", mode: "navigate" }) })).toBeUndefined();
    expect(worker.writes).toEqual([]);
  });

  it("a request to another origin is left alone", async () => {
    const worker = loadWorker(true);
    expect(await worker.fire("fetch", { request: { url: "https://elsewhere.example/api/x", method: "GET", mode: "cors" } })).toBeUndefined();
  });

  it("a navigation goes to the network and the page is not stored; offline it falls back to the offline page", async () => {
    const online = loadWorker(true);
    expect(await online.fire("fetch", { request: online.request("/", { mode: "navigate" }) })).toBe("network-response");
    expect(online.writes).toEqual([]);
    const offline = loadWorker(false);
    await offline.fire("install", {});
    expect(await offline.fire("fetch", { request: offline.request("/", { mode: "navigate" }) })).toBe("cached:/offline.html");
  });

  it("an allowed icon is served from the cache", async () => {
    const worker = loadWorker(false);
    await worker.fire("install", {});
    expect(await worker.fire("fetch", { request: worker.request("/icons/icon-192.png") })).toBe("cached:/icons/icon-192.png");
  });
});
