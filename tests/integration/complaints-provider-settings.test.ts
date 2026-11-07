import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createComplaint } from "@/server/complaints/create";
import { createClassifierFromEnv } from "@/server/complaints/providers/factory";
import { answerBody, FakeProvider, respondJson } from "../server/complaints/providers/fake-provider";
import { NOW, type World, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

const KEY = "test-key-not-a-secret-123";
const MARK = "LEAKMARK";
const primary = new FakeProvider();
const secondary = new FakeProvider();
let world: World;
let output: string[] = [];

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
  output = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const badPrimary = () => ({ JEV_PRIMARY_URL: `http://${MARK}.example/x`, JEV_PRIMARY_KEY: KEY, JEV_SECONDARY_URL: secondary.url, JEV_SECONDARY_KEY: KEY, JEV_TIMEOUT_MS: MARK });
const bothBad = () => ({ JEV_PRIMARY_URL: `ftp://${MARK}.example/x`, JEV_PRIMARY_KEY: KEY, JEV_SECONDARY_KEY: KEY, JEV_DAILY_CAP: "-1" });
const providerRequests = () => primary.requests.length + secondary.requests.length;

async function raise(env: Record<string, string>, body: string, declaredDanger = false) {
  const resident = await makeResident(world);
  const result = await createComplaint({ db: world.appPrisma, user: resident.user, body, now: NOW, classifier: createClassifierFromEnv(env), declaredDanger });
  if (result.status !== "OK") throw new Error(result.error);
  return loadComplaint(world, result.complaint.id);
}

describe("PV12 provider settings never block a complaint (D145)", () => {
  it("an invalid primary with a valid secondary: the secondary classifies, the primary gets no request, and no value is logged", async () => {
    secondary.behaviour = respondJson(200, answerBody("ELECTRICAL", "NORMAL", 0.88, 0.8));
    const saved = await raise(badPrimary(), "The light in the corridor is not working");
    expect(saved).toMatchObject({ category: { code: "ELECTRICAL" }, safetyFlag: false });
    expect(saved.classifications[0].source).toBe("LLM");
    expect(Number(saved.classifications[0].confidence)).toBe(0.88);
    expect(primary.requests).toHaveLength(0);
    expect(secondary.requests).toHaveLength(1);
    expect(output.join("\n")).not.toContain(MARK);
    expect(output).toEqual(["classifier setting invalid: JEV_PRIMARY_URL", "classifier setting invalid: JEV_TIMEOUT_MS"]);
  });

  it("both providers invalid: a NORMAL complaint is classified by the keyword fallback, with no provider request", async () => {
    const saved = await raise(bothBad(), "There is a water leak in the bathroom ceiling");
    expect(saved).toMatchObject({ category: { code: "PLUMBING" }, safetyFlag: false });
    expect(saved.urgency).not.toBe("CRITICAL");
    expect(saved.classifications[0]).toMatchObject({ source: "FALLBACK", confidence: null });
    expect(providerRequests()).toBe(0);
    expect(output.join("\n")).not.toContain(MARK);
  });

  it.each([
    ["a safety word", "There is a gas leak in the corridor of block C", false, "SAFETY_RULE"],
    ["a declared danger", "the garden bench needs paint", true, "DECLARED"],
  ])("%s is raised with the settings invalid: CRITICAL, escalated, assigned, notified, and zero provider requests", async (_name, body, declaredDanger, reason) => {
    for (const env of [badPrimary(), bothBad()]) {
      const saved = await raise(env, body, declaredDanger);
      expect(saved).toMatchObject({ status: "ASSIGNED", urgency: "CRITICAL", safetyFlag: true, assigneeId: world.staff.sanjay.id });
      expect(saved.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ESCALATED", "ASSIGNED"]);
      expect(saved.events[2].payload).toEqual({ reason, to: world.staff.sanjay.id });
      expect(saved.classifications[0]).toMatchObject({ source: "RULE", urgency: "CRITICAL" });
      expect(await world.ownerPrisma.notification.count({ where: { idempotencyKey: `safety-alert:${saved.id}`, kind: "SAFETY_ALERT" } })).toBe(1);
    }
    expect(providerRequests()).toBe(0);
  });

  describe("the route handler, with the classifier built from the process environment", () => {
    const guards = () => createGuards(() => ({ db: world.appPrisma, sender: mockOtpSender, now: () => NOW }));

    async function post(variables: Record<string, string>, body: unknown): Promise<Response> {
      for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value);
      vi.resetModules();
      const { handleCreate } = await import("@/server/complaints/handlers");
      const resident = await makeResident(world);
      const cookie = await world.signIn(resident.user.id, "RESIDENT", NOW);
      const route = guards().withPermission("RESIDENT", (context) => handleCreate(context, { now: NOW }));
      const request = new Request("http://localhost/api/complaints", { method: "POST", headers: { host: "localhost", cookie, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
      return route(request);
    }

    it.each([
      ["a normal complaint, an invalid primary and a valid secondary", badPrimary(), { body: "The tap in the kitchen is leaking" }],
      ["a normal complaint, both providers invalid", bothBad(), { body: "The tap in the kitchen is leaking" }],
      ["a safety complaint, both providers invalid", bothBad(), { body: "There is a fire in the parking lot" }],
      ["a declared danger, an invalid primary", badPrimary(), { body: "the garden bench needs paint", declaredDanger: true }],
      ["every number garbage", { JEV_TIMEOUT_MS: "x", JEV_DAILY_CAP: "-3", JEV_BREAKER_FAILURES: "NaN", JEV_BREAKER_COOLDOWN_SECONDS: "0" }, { body: "The tap in the kitchen is leaking" }],
    ])("%s: 201, never a 500", async (_name, variables, body) => {
      const response = await post(variables, body);
      expect(response.status).toBe(201);
      expect(output.join("\n")).not.toContain(MARK);
    });
  });
});
