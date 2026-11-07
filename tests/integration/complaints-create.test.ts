import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreateResult, createComplaint } from "@/server/complaints/create";
import { type Classifier, NullClassifier } from "@/server/complaints/classifier";
import { DAY, FakeClassifier, NOW, type World, arm, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
beforeAll(async () => {
  world = await setupWorld();
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const raise = (user: Awaited<ReturnType<typeof makeResident>>["user"], body: unknown, classifier: Classifier = new FakeClassifier(), options: { now?: number; budgetMs?: number } = {}) =>
  createComplaint({ db: world.appPrisma, user, body, now: options.now ?? NOW, classifier, budgetMs: options.budgetMs });
const ok = (result: CreateResult) => {
  if (result.status !== "OK") throw new Error(`expected OK, got ${result.error}`);
  return result;
};

describe("CL2 raising: the text and the script label", () => {
  it.each([
    ["English", "The water tap in my bathroom is leaking", "LATIN"],
    ["Hindi (Devanagari)", "मेरे बाथरूम में नल से पानी टपक रहा है", "DEVANAGARI"],
    ["Hinglish (Hindi in Latin letters)", "mere bathroom ke nal se paani tapak raha hai", "LATIN"],
    ["Marathi (Devanagari)", "माझ्या बाथरूममधील नळ गळत आहे", "DEVANAGARI"],
    ["Mixed scripts", "bathroom में नल से पानी leak हो रहा है", "MIXED"],
  ])("CL2 %s: stored as written, with the script label %s", async (_name, text, label) => {
    const { user } = await makeResident(world);
    const { complaint } = ok(await raise(user, text));
    const saved = await loadComplaint(world, complaint.id);
    expect(saved.body).toBe(text);
    expect(saved.language).toBe(label);
    expect(saved.flatId).toBeTruthy();
    expect(saved.raisedById).toBe(user.id);
  });

  it("CL2 the text is trimmed and its control characters are removed, but its words and lines are kept", async () => {
    const { user } = await makeResident(world);
    const { complaint } = ok(await raise(user, "  Water\u0000 leak\r\nunder\tthe \u0007sink  \n"));
    expect((await loadComplaint(world, complaint.id)).body).toBe("Water leak\nunder\tthe sink");
  });

  it("CL2 a blank text, a text over 2,000 characters and a value that is not text are VALIDATION; 2,000 characters are fine", async () => {
    const { user } = await makeResident(world);
    for (const body of ["", "   \n\t ", "\u0000\u0001", "x".repeat(2001), 42, null, undefined, { text: "a" }]) {
      expect(await raise(user, body), String(body).slice(0, 12)).toEqual({ status: "ERROR", error: "VALIDATION" });
    }
    ok(await raise(user, "x".repeat(2000)));
    ok(await raise(user, "आ".repeat(2000)));
  });

  it("CL2 a resident without a current flat gets NO_FLAT; staff and an inactive resident get FORBIDDEN; nothing is written", async () => {
    const before = await world.ownerPrisma.complaint.count();
    const nobody = await makeResident(world);
    await world.ownerPrisma.flatMember.updateMany({ where: { userId: nobody.user.id }, data: { endsOn: new Date("2026-02-01T00:00:00Z") } });
    expect(await raise(nobody.user, "Water leak")).toEqual({ status: "ERROR", error: "NO_FLAT" });
    expect(await raise(world.staff.kavita, "Water leak")).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    const resident = await makeResident(world);
    expect(await raise({ ...resident.user, active: false }, "Water leak")).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await world.ownerPrisma.complaint.count()).toBe(before);
  });
});

describe("CL2 the safety path (D9, D73, D119)", () => {
  it.each([
    ["English fire", "There is a fire in the parking lot"],
    ["English gas", "There is a gas leak in the kitchen"],
    ["English lift", "My mother is stuck in the lift"],
    ["English shock", "I got an electric shock from the switch"],
    ["Hindi fire", "बिल्डिंग में आग है"],
    ["Hinglish fire", "tower 2 mein aag lagi hai"],
    ["Marathi fire", "इमारतीला आगी लागली"],
    ["Marathi smoke", "तळघरातून धूर येत आहे"],
  ])("CL2 %s: CRITICAL, assigned to the duty manager with ESCALATED, a notification, and no classifier call", async (_name, text) => {
    const { user, flat } = await makeResident(world);
    const classifier = new FakeClassifier({ result: arm("OTHER", 0.95, "LOW", 0.95 /* a model would have said OTHER and LOW */) });
    const { complaint } = ok(await raise(user, text, classifier));
    expect(classifier.calls).toBe(0);
    expect(complaint).toMatchObject({ status: "ASSIGNED", urgency: "CRITICAL", safetyFlag: true, assigned: true });

    const saved = await loadComplaint(world, complaint.id);
    expect(saved.assigneeId).toBe(world.staff.sanjay.id);
    expect(saved.responseDueAt?.getTime()).toBe(NOW + 15 * 60_000);
    expect(saved.firstResponseAt).toBeNull();
    expect(saved.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ESCALATED", "ASSIGNED"]);
    expect(saved.events[1].payload).toMatchObject({ source: "RULE", urgency: "CRITICAL" });
    expect(saved.events[2].payload).toEqual({ reason: "SAFETY_RULE", to: world.staff.sanjay.id });
    expect(saved.classifications).toHaveLength(1);
    expect(saved.classifications[0]).toMatchObject({ source: "RULE", urgency: "CRITICAL", latencyMs: 0 });
    expect(saved.classifications[0].outputHash).toMatch(/^[0-9a-f]{64}$/);

    const notes = await world.ownerPrisma.notification.findMany({ where: { idempotencyKey: `safety-alert:${complaint.id}` } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "SAFETY_ALERT", recipientId: world.staff.sanjay.id, status: "PENDING" });
    const noteText = JSON.stringify(notes[0].body);
    for (const personal of [text, user.name, flat.code]) expect(noteText).not.toContain(personal);
  });

  it("CL2 with no duty manager the complaint stays NEW, ESCALATED says so, and there is no notification; with several the smallest name gets it", async () => {
    await world.ownerPrisma.user.update({ where: { id: world.staff.sanjay.id }, data: { active: false } });
    const { user } = await makeResident(world);
    const none = ok(await raise(user, "gas leak in the corridor")).complaint;
    const noneRow = await loadComplaint(world, none.id);
    expect(noneRow).toMatchObject({ status: "NEW", assigneeId: null, urgency: "CRITICAL", safetyFlag: true });
    expect(noneRow.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ESCALATED"]);
    expect(noneRow.events[2].payload).toEqual({ reason: "SAFETY_RULE", to: null, note: "NO_DUTY_MANAGER" });
    expect(await world.ownerPrisma.notification.count({ where: { idempotencyKey: `safety-alert:${none.id}` } })).toBe(0);

    await world.ownerPrisma.user.update({ where: { id: world.staff.sanjay.id }, data: { active: true } });
    const aarav = await world.ownerPrisma.user.create({ data: { phone: "5900000099", name: "Aarav Dutt", role: "STAFF", permissions: { create: [{ permission: "complaints:duty_manager" }] } } });
    const first = ok(await raise(user, "fire in the basement")).complaint;
    expect((await loadComplaint(world, first.id)).assigneeId).toBe(aarav.id);
    await world.ownerPrisma.user.update({ where: { id: aarav.id }, data: { active: false } });
  });
});

describe("CL2 the classifier path (D9, D118)", () => {
  it("CL2 a non-safety complaint takes the classifier's category, urgency and confidence, and the category's default assignee", async () => {
    const { user } = await makeResident(world);
    const classifier = new FakeClassifier({ result: arm("ELECTRICAL", 0.91, "HIGH", 0.8) });
    const { complaint } = ok(await raise(user, "The corridor light on our floor does not work", classifier));
    expect(complaint).toMatchObject({ status: "ASSIGNED", urgency: "HIGH", category: "ELECTRICAL", safetyFlag: false, needsReview: false });
    const saved = await loadComplaint(world, complaint.id);
    expect(saved.assigneeId).toBe(world.staff.kavita.id);
    expect(saved.responseDueAt?.getTime()).toBe(NOW + 120 * 60_000);
    expect(saved.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ASSIGNED"]);
    expect(saved.classifications[0]).toMatchObject({ source: "LLM", urgency: "HIGH" });
    expect(Number(saved.classifications[0].confidence)).toBeCloseTo(0.91, 3);
    expect(saved.classifications[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(saved.classifications[0].outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  const FALLBACK_TEXT = "Water leak under the sink";
  const crit = { ...arm("PLUMBING"), urgencies: [{ label: "CRITICAL", probability: 1 }] };
  it.each<[string, FakeClassifier, number | undefined]>([
    ["throws", new FakeClassifier({ throws: true }), undefined],
    ["is slower than the budget", new FakeClassifier({ delayMs: 400, result: arm("ELECTRICAL") }), 60],
    ["answers with something invalid", new FakeClassifier({ invalid: { arm: "DIRECT", categories: "plumbing" } }), undefined],
    ["answers CRITICAL for a non-safety complaint", new FakeClassifier({ result: crit as never }), undefined],
    ["gives nothing", new FakeClassifier({ result: null }), undefined],
  ])("CL2 a classifier that %s gives the keyword fallback", async (_name, classifier, budgetMs) => {
    const { user } = await makeResident(world);
    const started = Date.now();
    const { complaint } = ok(await raise(user, FALLBACK_TEXT, classifier, { budgetMs }));
    if (budgetMs !== undefined) {
      expect(Date.now() - started).toBeLessThan(350);
      expect(classifier.aborted).toBe(true);
    }
    expect(classifier.calls).toBe(1);
    expect(complaint).toMatchObject({ category: "PLUMBING", urgency: "NORMAL", status: "ASSIGNED", safetyFlag: false });
    const saved = await loadComplaint(world, complaint.id);
    expect(saved.classifications[0]).toMatchObject({ source: "FALLBACK", confidence: null });
    expect(saved.assigneeId).toBe(world.staff.kavita.id);
  });

  it("CL2 a valid answer that decideClassification refuses (low confidence) goes to a person, not to the fallback", async () => {
    const { user } = await makeResident(world);
    const { complaint } = ok(await raise(user, FALLBACK_TEXT, new FakeClassifier({ result: arm("ELECTRICAL", 0.5) })));
    expect(complaint).toMatchObject({ category: null, status: "NEW", needsReview: true, assigned: false });
  });

  it("CL2 nothing at all (no classifier answer and no keyword): needs_review, no assignee, status NEW, a FALLBACK row with no category", async () => {
    const { user } = await makeResident(world);
    const { complaint } = ok(await raise(user, "Please look into the matter soon", new FakeClassifier()));
    expect(complaint).toMatchObject({ category: null, status: "NEW", needsReview: true, assigned: false, safetyFlag: false });
    const saved = await loadComplaint(world, complaint.id);
    expect(saved.assigneeId).toBeNull();
    expect(saved.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED"]);
    expect(saved.classifications).toHaveLength(1);
    expect(saved.classifications[0]).toMatchObject({ source: "FALLBACK", categoryId: null });
  });

  it("CL2 the production NullClassifier gives the keyword fallback", async () => {
    const { user } = await makeResident(world);
    const { complaint } = ok(await raise(user, "Water leak under the sink", NullClassifier));
    expect(complaint).toMatchObject({ category: "PLUMBING", status: "ASSIGNED" });
  });

  it("CL2 the text sent to the classifier has no phone, e-mail, flat code or the resident's name", async () => {
    const { user, flat } = await makeResident(world, "Swati Joshi", "T12-0408");
    const classifier = new FakeClassifier();
    const text = `Hi, I am Swati Joshi of flat ${flat.code} (also written T12 0408). Call me on 9876543210 or +91 98765 43210, mail swati.joshi@example.com. The tap in the bathroom leaks.`;
    ok(await raise(user, text, classifier));
    expect(classifier.calls).toBe(1);
    const sent = classifier.inputs[0];
    expect(sent.arm).toBe("DIRECT");
    for (const personal of ["9876543210", "98765 43210", "swati.joshi@example.com", "example.com", "T12-0408", "0408", "Swati", "Joshi"]) expect(sent.text, personal).not.toContain(personal);
    expect(sent.text).toContain("tap in the bathroom leaks");
    expect((await world.ownerPrisma.complaint.findFirstOrThrow({ where: { raisedById: user.id } })).body).toBe(text);
  });
});

describe("CL8 a repeat is the same complaint, and raising is quick", () => {
  it("CL8 the same text by the same person within 60 seconds returns the first complaint; the classifier is not asked again", async () => {
    const { user } = await makeResident(world);
    const classifier = new FakeClassifier({ result: arm("PLUMBING") });
    const first = ok(await raise(user, "Water leak under the sink", classifier));
    expect(first.duplicate).toBe(false);
    const again = ok(await raise(user, "  water   LEAK under the sink ", classifier, { now: NOW + 59_000 }));
    expect(again).toMatchObject({ duplicate: true, complaint: { id: first.complaint.id } });
    expect(classifier.calls).toBe(1);
    const later = ok(await raise(user, "Water leak under the sink", classifier, { now: NOW + 61_000 }));
    expect(later.duplicate).toBe(false);
    expect(later.complaint.id).not.toBe(first.complaint.id);
    expect(await world.ownerPrisma.complaint.count({ where: { raisedById: user.id } })).toBe(2);
  });

  it("CL8 the same text from another resident is a different complaint", async () => {
    const a = await makeResident(world);
    const b = await makeResident(world);
    const one = ok(await raise(a.user, "Water leak under the sink"));
    const two = ok(await raise(b.user, "Water leak under the sink"));
    expect(two.complaint.id).not.toBe(one.complaint.id);
  });

  it("CL8 six requests for the same text at the same moment make one complaint", async () => {
    const { user } = await makeResident(world);
    const results = await Promise.all(Array.from({ length: 6 }, () => raise(user, "Lift lobby light is flickering")));
    const ids = new Set(results.map((r) => ok(r).complaint.id));
    expect(ids.size).toBe(1);
    expect(await world.ownerPrisma.complaint.count({ where: { raisedById: user.id } })).toBe(1);
    expect(results.filter((r) => r.status === "OK" && !r.duplicate)).toHaveLength(1);
  });

  it("CL8 200 complaints are raised in under 3 seconds (8 at a time, each with its classification and events)", async () => {
    const people = await Promise.all(Array.from({ length: 8 }, () => makeResident(world)));
    const classifier = new FakeClassifier({ result: arm("HOUSEKEEPING") });
    const started = performance.now();
    for (let batch = 0; batch < 25; batch++) {
      await Promise.all(people.map((p, i) => raise(p.user, `Dustbin is overflowing, report ${batch}-${i}`, classifier).then(ok)));
    }
    const elapsed = performance.now() - started;
    expect(elapsed, `${Math.round(elapsed)} ms`).toBeLessThan(3000);
    const ids = people.map((p) => p.user.id);
    expect(await world.ownerPrisma.complaint.count({ where: { raisedById: { in: ids } } })).toBe(200);
    expect(await world.ownerPrisma.classification.count({ where: { complaint: { raisedById: { in: ids } } } })).toBe(200);
  }, 30_000);

  it("CL8 the same text a day later is a new complaint (the window is 60 seconds)", async () => {
    const { user } = await makeResident(world);
    ok(await raise(user, "Gate is broken", new FakeClassifier(), { now: NOW }));
    expect(ok(await raise(user, "Gate is broken", new FakeClassifier(), { now: NOW + DAY })).duplicate).toBe(false);
  });
});
