import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createComplaint } from "@/server/complaints/create";
import { createClassifierFromEnv } from "@/server/complaints/providers/factory";
import { answerBody, FakeProvider, hang, respondJson } from "../server/complaints/providers/fake-provider";
import { NOW, type World, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

const KEY = "test-key-not-a-secret-123";
const primary = new FakeProvider();
const secondary = new FakeProvider();
let world: World;

beforeAll(async () => {
  world = await setupWorld();
  await Promise.all([primary.start(), secondary.start()]);
}, 120_000);
afterAll(async () => {
  await Promise.all([primary.stop(), secondary.stop()]);
  await world?.close();
}, 60_000);
beforeEach(() => {
  for (const fake of [primary, secondary]) {
    fake.requests.length = 0;
    fake.behaviour = respondJson(200, answerBody());
  }
});

const classifier = (timeoutMs = 1500) =>
  createClassifierFromEnv({
    JEV_PRIMARY_URL: primary.url,
    JEV_PRIMARY_MODEL: "jev-latest",
    JEV_PRIMARY_KEY: KEY,
    JEV_SECONDARY_URL: secondary.url,
    JEV_SECONDARY_MODEL: "jev-latest",
    JEV_SECONDARY_KEY: KEY,
    JEV_TIMEOUT_MS: String(timeoutMs),
  });

async function raise(body: string, options: { declaredDanger?: boolean; budgetMs?: number; timeoutMs?: number } = {}) {
  const resident = await makeResident(world);
  const result = await createComplaint({ db: world.appPrisma, user: resident.user, body, now: NOW, classifier: classifier(options.timeoutMs), budgetMs: options.budgetMs, declaredDanger: options.declaredDanger });
  if (result.status !== "OK") throw new Error(result.error);
  return loadComplaint(world, result.complaint.id);
}

describe("PV9 createComplaint with the provider chain and the real decision rules", () => {
  it("a normal complaint is classified by the provider; the probability is stored as the confidence; only de-identified text was sent", async () => {
    const saved = await raise("Swati Joshi of flat T12-0408 says the kitchen tap is leaking, call 5000000007");
    expect(saved).toMatchObject({ category: { code: "PLUMBING" }, urgency: "NORMAL", safetyFlag: false });
    expect(saved.classifications).toHaveLength(1);
    expect(saved.classifications[0].source).toBe("LLM");
    expect(Number(saved.classifications[0].confidence)).toBe(0.9);
    expect(saved.classifications[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(primary.requests).toHaveLength(1);
    expect(secondary.requests).toHaveLength(0);
    const sent = (primary.requests[0].body as { state: string }).state;
    expect(sent).toContain("kitchen tap is leaking");
    for (const personal of ["Swati", "Joshi", "T12-0408", "5000000007"]) expect(primary.requests[0].raw).not.toContain(personal);
  });

  it("a safety complaint NEVER reaches a provider: zero requests, CRITICAL by rule", async () => {
    const saved = await raise("There is a gas leak in the corridor of block C");
    expect(saved).toMatchObject({ safetyFlag: true, urgency: "CRITICAL" });
    expect(saved.classifications[0].source).toBe("RULE");
    expect(primary.requests.length + secondary.requests.length).toBe(0);
  });

  it("a declared danger never reaches a provider either", async () => {
    const saved = await raise("the tap is leaking", { declaredDanger: true });
    expect(saved).toMatchObject({ safetyFlag: true, urgency: "CRITICAL" });
    expect(primary.requests.length + secondary.requests.length).toBe(0);
  });

  it("a provider answering CRITICAL is refused and the keyword fallback runs (the secondary is then tried, also refused)", async () => {
    const critical = answerBody() as { answers: { urgency: { probabilities: Record<string, number> } } };
    critical.answers.urgency.probabilities = { CRITICAL: 1, NORMAL: 0, LOW: 0 };
    primary.behaviour = respondJson(200, critical);
    secondary.behaviour = respondJson(200, critical);
    const saved = await raise("There is a water leak in the bathroom ceiling");
    expect(saved).toMatchObject({ category: { code: "PLUMBING" }, safetyFlag: false });
    expect(saved.urgency).not.toBe("CRITICAL");
    expect(saved.classifications[0]).toMatchObject({ source: "FALLBACK", confidence: null });
    expect(primary.requests).toHaveLength(1);
    expect(secondary.requests).toHaveLength(1);
  });

  it("the primary down: the secondary classifies it", async () => {
    primary.behaviour = respondJson(429, {}, { "retry-after": "1" });
    secondary.behaviour = respondJson(200, answerBody("ELECTRICAL", "HIGH", 0.85, 0.75));
    const saved = await raise("The light in the corridor is not working");
    expect(saved).toMatchObject({ category: { code: "ELECTRICAL" }, urgency: "HIGH" });
    expect(saved.classifications[0].source).toBe("LLM");
    expect(Number(saved.classifications[0].confidence)).toBe(0.85);
  });

  it("both providers down: the keyword fallback answers inside the budget", async () => {
    primary.behaviour = hang;
    secondary.behaviour = hang;
    const started = Date.now();
    const saved = await raise("There is a water leak in the bathroom ceiling", { budgetMs: 800, timeoutMs: 4000 });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(saved.classifications[0]).toMatchObject({ source: "FALLBACK", confidence: null });
    expect(saved.classifications[0].latencyMs).toBeLessThan(1200);
    expect(saved.category?.code).toBe("PLUMBING");
  });
});
