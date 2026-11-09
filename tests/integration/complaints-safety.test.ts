import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { autoCloseDue } from "@/server/complaints/auto-close";
import { createComplaint } from "@/server/complaints/create";
import { getComplaint } from "@/server/complaints/read";
import { acknowledgeSafety, closeSafety } from "@/server/complaints/safety";
import { getHomeData } from "@/server/home/home-data";
import { DAY, FakeClassifier, NOW, type World, arm, arrange, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
beforeAll(async () => {
  world = await setupWorld();
  await world.ownerPrisma.societySetting.create({ data: { key: "late_fee_policy", value: { ...defaultLateFeePolicy } } });
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const db = () => world.appPrisma;
type Resident = Awaited<ReturnType<typeof makeResident>>;
const raise = async (r: Resident, body: string, at = NOW) => {
  const result = await createComplaint({ db: db(), user: r.user, body, now: at, classifier: new FakeClassifier({ result: arm("PLUMBING") }) });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint.id;
};
const sanjay = () => world.staff.sanjay;
const kavita = () => world.staff.kavita;
const pendingSince = async (r: Resident, since: number, body: string) => {
  const id = await raise(r, body, since - DAY);
  await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(since), firstResponseAt: new Date(since - DAY / 2) });
  return id;
};

describe("A-002 lift stuck phrases in Marathi and Hinglish escalate by rule before any model", () => {
  it.each(["लिफ्ट अडकली", "लिफ्ट अडकली आहे", "लिफ्ट अडकल्यामुळे लोक आत आहेत", "lift mein phas gaye", "lift me atak gaya", "lift band ho gayi aur log andar fase hain"])(
    "A-002 %j is CRITICAL, flagged for safety, and the provider is never called",
    async (body) => {
      const r = await makeResident(world);
      const classifier = new FakeClassifier({ result: arm("PLUMBING") });
      const result = await createComplaint({ db: db(), user: r.user, body, now: NOW, classifier });
      if (result.status !== "OK") throw new Error(result.error);
      expect(classifier.calls).toBe(0);
      expect(await loadComplaint(world, result.complaint.id)).toMatchObject({ urgency: "CRITICAL", safetyFlag: true });
    },
  );
});

describe("CL3 the duty manager acknowledges and closes a safety complaint (D15, D39)", () => {
  it("CL3 acknowledge sets first_response_at, records a COMMENT event of kind 'ack' and an audit row; a second acknowledge changes nothing; the resident never sees it", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "There is a gas leak in the corridor");
    expect((await loadComplaint(world, id)).firstResponseAt).toBeNull();
    expect(await acknowledgeSafety({ db: db(), user: sanjay(), id, now: NOW + 4 * 60_000 })).toMatchObject({ status: "OK", complaint: { id, status: "ASSIGNED", version: 1 } });
    expect(await acknowledgeSafety({ db: db(), user: sanjay(), id, now: NOW + 9 * 60_000 })).toMatchObject({ status: "OK" });
    const saved = await loadComplaint(world, id);
    expect(saved.firstResponseAt?.getTime()).toBe(NOW + 4 * 60_000);
    const acks = saved.events.filter((e) => e.eventType === "COMMENT");
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ actorId: sanjay().id, payload: { kind: "ack" } });
    expect(await world.ownerPrisma.auditLog.count({ where: { entityId: id, action: "COMPLAINT_ACKNOWLEDGED" } })).toBe(1);
    const detail = await getComplaint({ db: db(), user: r.user, id, now: NOW + 10 * 60_000 });
    if (detail.status !== "OK") throw new Error(detail.error);
    expect(detail.complaint.timeline.map((t) => t.label)).toEqual(["Raised", "Sent to the duty manager"]);
  });

  it("CL3 acknowledge and close need complaints:duty_manager: a staff user with only complaints:manage, the accounts user and a resident get FORBIDDEN", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "There is a gas leak in the corridor");
    for (const user of [kavita(), world.staff.priya, r.user]) {
      expect(await acknowledgeSafety({ db: db(), user, id, now: NOW }), user.name).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await closeSafety({ db: db(), user, id, note: "Gas isolated and checked", now: NOW }), user.name).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    }
    expect(await loadComplaint(world, id)).toMatchObject({ status: "ASSIGNED", closeKind: null, firstResponseAt: null, version: 1 });
  });

  it("CL3 closeSafety closes with DUTY_MANAGER, a CLOSED event and an audit row; the complaint leaves the SAFETY lane", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "There is a gas leak in the corridor");
    const result = await closeSafety({ db: db(), user: sanjay(), id, note: "  Gas isolated, valve replaced ", now: NOW + 3600_000 });
    expect(result).toMatchObject({ status: "OK", complaint: { status: "CLOSED", version: 2 } });
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ status: "CLOSED", closeKind: "DUTY_MANAGER", rating: null, safetyFlag: true, urgency: "CRITICAL" });
    expect(saved.closedAt?.getTime()).toBe(NOW + 3600_000);
    expect(saved.firstResponseAt?.getTime()).toBe(NOW + 3600_000);
    expect(saved.events.at(-1)).toMatchObject({ eventType: "CLOSED", actorId: sanjay().id, payload: { closeKind: "DUTY_MANAGER", note: "Gas isolated, valve replaced" } });
    expect(await world.ownerPrisma.auditLog.count({ where: { entityId: id, action: "COMPLAINT_SAFETY_CLOSED" } })).toBe(1);
    const detail = await getComplaint({ db: db(), user: r.user, id, now: NOW + 3600_000 });
    if (detail.status !== "OK") throw new Error(detail.error);
    expect(detail.complaint.timeline.at(-1)?.label).toBe("Closed by the duty manager");
    expect(JSON.stringify(detail)).not.toContain("valve");
    expect(await closeSafety({ db: db(), user: sanjay(), id, note: "Closing again", now: NOW + 3600_001 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    expect(await acknowledgeSafety({ db: db(), user: sanjay(), id, now: NOW + 3600_001 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
  });

  it("CL3 closeSafety needs a note of 5 to 500 characters, and only works on a safety complaint", async () => {
    const r = await makeResident(world);
    const safety = await raise(r, "There is a gas leak in the corridor");
    for (const note of ["", "no", "     ", "x".repeat(501)]) expect(await closeSafety({ db: db(), user: sanjay(), id: safety, note, now: NOW }), note.slice(0, 3)).toEqual({ status: "ERROR", error: "VALIDATION" });
    const plain = await raise(r, "Water leak under the sink");
    expect(await closeSafety({ db: db(), user: sanjay(), id: plain, note: "Closing this one", now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    expect(await acknowledgeSafety({ db: db(), user: sanjay(), id: plain, now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    expect(await closeSafety({ db: db(), user: sanjay(), id: "00000000-0000-4000-8000-000000000000", note: "Closing this one", now: NOW })).toEqual({ status: "ERROR", error: "NOT_FOUND" });
    expect(await loadComplaint(world, plain)).toMatchObject({ status: "ASSIGNED", closeKind: null });
    expect(await loadComplaint(world, safety)).toMatchObject({ status: "ASSIGNED", closeKind: null });
  });
});

describe("CL5 auto-close (D15, D120)", () => {
  it("CL5 after 7 days a PENDING_CONFIRMATION complaint becomes AUTO_CLOSED with a CLOSED event and no rating; before that it stays", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW, "Water leak under the sink");
    expect(await autoCloseDue({ db: db(), now: NOW + 7 * DAY - 1 })).toBe(0);
    expect((await loadComplaint(world, id)).status).toBe("PENDING_CONFIRMATION");
    expect(await autoCloseDue({ db: db(), now: NOW + 7 * DAY })).toBe(1);
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ status: "CLOSED", closeKind: "AUTO_CLOSED", rating: null, version: 2 });
    expect(saved.closedAt?.getTime()).toBe(NOW + 7 * DAY);
    expect(saved.events.at(-1)).toMatchObject({ eventType: "CLOSED", actorId: null, payload: { closeKind: "AUTO_CLOSED", rating: null } });
    const detail = await getComplaint({ db: db(), user: r.user, id, now: NOW + 7 * DAY });
    if (detail.status !== "OK") throw new Error(detail.error);
    expect(detail.complaint.timeline.at(-1)?.label).toBe("Closed automatically after no answer");
  });

  it("CL5 a safety complaint is never auto-closed, however long it waits", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "There is a gas leak in the corridor");
    await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 30 * DAY), firstResponseAt: new Date(NOW - 30 * DAY) });
    expect(await autoCloseDue({ db: db(), now: NOW + 365 * DAY })).toBe(0);
    expect(await loadComplaint(world, id)).toMatchObject({ status: "PENDING_CONFIRMATION", closeKind: null, safetyFlag: true });
  });

  it("CL5 it is idempotent: a second call closes nothing and adds no event", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - 10 * DAY, "Corridor light is out");
    expect(await autoCloseDue({ db: db(), now: NOW })).toBe(1);
    const events = (await loadComplaint(world, id)).events.length;
    expect(await autoCloseDue({ db: db(), now: NOW })).toBe(0);
    expect(await autoCloseDue({ db: db(), now: NOW + DAY })).toBe(0);
    expect((await loadComplaint(world, id)).events).toHaveLength(events);
  });

  it("CL5 the number of days is the auto_close_days setting", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW, "Dustbin is overflowing");
    await world.ownerPrisma.societySetting.update({ where: { key: "auto_close_days" }, data: { value: 3 } });
    expect(await autoCloseDue({ db: db(), now: NOW + 3 * DAY - 1 })).toBe(0);
    expect(await autoCloseDue({ db: db(), now: NOW + 3 * DAY })).toBe(1);
    expect((await loadComplaint(world, id)).closeKind).toBe("AUTO_CLOSED");
    await world.ownerPrisma.societySetting.update({ where: { key: "auto_close_days" }, data: { value: 7 } });
  });

  it("CL5 105 waiting complaints are all closed in one call (it works in chunks of 100), quickly", async () => {
    const r = await makeResident(world);
    const flat = await world.ownerPrisma.flatMember.findFirstOrThrow({ where: { userId: r.user.id }, select: { flatId: true } });
    const since = new Date(NOW - 20 * DAY);
    await world.ownerPrisma.complaint.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({ flatId: flat.flatId, raisedById: r.user.id, body: `Old complaint ${i}`, status: "PENDING_CONFIRMATION" as const, pendingConfirmationAt: since, createdAt: new Date(NOW - 21 * DAY) })),
    });
    const started = performance.now();
    expect(await autoCloseDue({ db: db(), now: NOW })).toBe(105);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(await world.ownerPrisma.complaint.count({ where: { raisedById: r.user.id, closeKind: "AUTO_CLOSED" } })).toBe(105);
  }, 30_000);

  it("CL5 the Home shows the right step for each status (Raised, Assigned, In progress, Resolved with an answer wanted; closed is not open)", async () => {
    const cases: [string, Parameters<typeof arrange>[2], 0 | 1 | 2 | 3 | null, boolean][] = [
      ["NEW", { status: "NEW", assigneeId: null }, 0, false],
      ["ASSIGNED", {}, 1, false],
      ["IN_PROGRESS", { status: "IN_PROGRESS", firstResponseAt: new Date(NOW) }, 2, false],
      ["PENDING_CONFIRMATION", { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW), firstResponseAt: new Date(NOW) }, 3, true],
      ["REOPENED", { status: "REOPENED", reopenCount: 1, firstResponseAt: new Date(NOW) }, 1, false],
      ["CLOSED", { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED", firstResponseAt: new Date(NOW) }, null, false],
    ];
    for (const [status, fields, current, needsAnswer] of cases) {
      const r = await makeResident(world);
      const id = await raise(r, `Water leak under the sink, case ${status}`);
      await arrange(world, id, fields);
      const home = await getHomeData({ db: db(), user: r.user, now: NOW });
      if (home.kind !== "OK") throw new Error(home.kind);
      if (current === null) expect(home.complaint, status).toBeNull();
      else expect(home.complaint, status).toMatchObject({ status, current, needsAnswer });
    }
  });
});
