import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createComplaint } from "@/server/complaints/create";
import { getComplaint } from "@/server/complaints/read";
import { addComment, assign, correctCategory, setStatus } from "@/server/complaints/staff-actions";
import { DAY, FakeClassifier, NOW, type World, arm, arrange, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
beforeAll(async () => {
  world = await setupWorld();
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const db = () => world.appPrisma;
type Resident = Awaited<ReturnType<typeof makeResident>>;
const raise = async (r: Resident, body: string, classifier = new FakeClassifier({ result: arm("PLUMBING") }), at = NOW) => {
  const result = await createComplaint({ db: db(), user: r.user, body, now: at, classifier });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint.id;
};
const kavita = () => world.staff.kavita;
function ok<T extends { status: string }>(result: T): Extract<T, { status: "OK" }> {
  if (result.status !== "OK") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "OK" }>;
}

describe("CL7 SLA and first response", () => {
  it("CL7 response_due_at comes from the society's sla_minutes (and the defaults when the setting is missing)", async () => {
    const r = await makeResident(world);
    const normal = await raise(r, "Water leak under the sink");
    expect((await loadComplaint(world, normal)).responseDueAt?.getTime()).toBe(NOW + 1440 * 60_000);
    const high = await raise(r, "Corridor light is out", new FakeClassifier({ result: arm("ELECTRICAL", 0.9, "HIGH") }));
    expect((await loadComplaint(world, high)).responseDueAt?.getTime()).toBe(NOW + 120 * 60_000);
    const low = await raise(r, "The garden bench needs paint", new FakeClassifier({ result: arm("OTHER", 0.9, "LOW") }));
    expect((await loadComplaint(world, low)).responseDueAt?.getTime()).toBe(NOW + 4320 * 60_000);
    const critical = await raise(r, "fire in tower 3");
    expect((await loadComplaint(world, critical)).responseDueAt?.getTime()).toBe(NOW + 15 * 60_000);

    await world.ownerPrisma.societySetting.update({ where: { key: "sla_minutes" }, data: { value: { CRITICAL: 5, HIGH: 30, NORMAL: 60, LOW: 90 } } });
    const changed = await raise(r, "Dustbin is overflowing today");
    expect((await loadComplaint(world, changed)).responseDueAt?.getTime()).toBe(NOW + 60 * 60_000);
    await world.ownerPrisma.societySetting.delete({ where: { key: "sla_minutes" } });
    const defaults = await raise(r, "Dustbin is overflowing again");
    expect((await loadComplaint(world, defaults)).responseDueAt?.getTime()).toBe(NOW + 1440 * 60_000);
    await world.ownerPrisma.societySetting.create({ data: { key: "sla_minutes", value: { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 } } });
  });

  it("CL7 the first staff action sets first_response_at once: a later action never changes it; raising and a resident's action do not set it", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    expect((await loadComplaint(world, id)).firstResponseAt).toBeNull();
    ok(await setStatus({ db: db(), user: kavita(), id, status: "IN_PROGRESS", expectedVersion: 1, now: NOW + 5 * 60_000 }));
    expect((await loadComplaint(world, id)).firstResponseAt?.getTime()).toBe(NOW + 5 * 60_000);
    ok(await addComment({ db: db(), user: kavita(), id, text: "On the way", visibleToResident: true, now: NOW + 9 * 60_000 }));
    ok(await setStatus({ db: db(), user: kavita(), id, status: "PENDING_CONFIRMATION", expectedVersion: 2, now: NOW + 20 * 60_000 }));
    expect((await loadComplaint(world, id)).firstResponseAt?.getTime()).toBe(NOW + 5 * 60_000);
  });

  it("CL7 a comment is a first response too, and assign is one", async () => {
    const r = await makeResident(world);
    const a = await raise(r, "Water leak under the sink");
    ok(await addComment({ db: db(), user: kavita(), id: a, text: "Seen", visibleToResident: false, now: NOW + 7 * 60_000 }));
    expect((await loadComplaint(world, a)).firstResponseAt?.getTime()).toBe(NOW + 7 * 60_000);
    const b = await raise(r, "Corridor light is out");
    ok(await assign({ db: db(), user: kavita(), id: b, assigneeUserId: world.staff.sanjay.id, expectedVersion: 1, now: NOW + 3 * 60_000 }));
    expect((await loadComplaint(world, b)).firstResponseAt?.getTime()).toBe(NOW + 3 * 60_000);
  });
});

describe("CL3 assign", () => {
  it("CL3 assigns to another staff user, raises the version, appends an ASSIGNED event and an audit row", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    const result = ok(await assign({ db: db(), user: kavita(), id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 1, now: NOW + 1000 }));
    expect(result.complaint).toEqual({ id, status: "ASSIGNED", version: 2, assigneeId: world.staff.sanjay.id });
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ assigneeId: world.staff.sanjay.id, version: 2 });
    expect(saved.events.at(-1)).toMatchObject({ eventType: "ASSIGNED", actorId: kavita().id, payload: { assignee: world.staff.sanjay.id, from: kavita().id } });
    const audit = await world.ownerPrisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "COMPLAINT_ASSIGNED" } });
    expect(audit).toMatchObject({ actorId: kavita().id, entityType: "complaint" });
    expect(JSON.stringify(audit.detail)).not.toContain("leak");
  });

  it("CL3 a NEW complaint becomes ASSIGNED; a reopened one too; a complaint waiting for the resident or closed cannot be assigned", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Please look into the matter soon", new FakeClassifier());
    expect(ok(await assign({ db: db(), user: kavita(), id, assigneeUserId: kavita().id, expectedVersion: 1, now: NOW })).complaint.status).toBe("ASSIGNED");
    await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW) });
    expect(await assign({ db: db(), user: kavita(), id, assigneeUserId: kavita().id, expectedVersion: 2, now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    await arrange(world, id, { status: "REOPENED", pendingConfirmationAt: null, reopenCount: 1 });
    expect(ok(await assign({ db: db(), user: kavita(), id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 2, now: NOW })).complaint.status).toBe("ASSIGNED");
  });

  it("CL3 the assignee must be an active staff user with complaints:manage (ASSIGNEE_INVALID); the version must match (STALE)", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    const resident = (await makeResident(world)).user;
    const inactive = await world.ownerPrisma.user.create({ data: { phone: "5900000071", name: "Gone Person", role: "STAFF", active: false, permissions: { create: [{ permission: "complaints:manage" }] } } });
    for (const assigneeUserId of [resident.id, world.staff.priya.id, inactive.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect(await assign({ db: db(), user: kavita(), id, assigneeUserId, expectedVersion: 1, now: NOW }), assigneeUserId).toEqual({ status: "ERROR", error: "ASSIGNEE_INVALID" });
    }
    expect(await assign({ db: db(), user: kavita(), id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 7, now: NOW })).toEqual({ status: "ERROR", error: "STALE" });
    expect(await assign({ db: db(), user: kavita(), id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 0, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await loadComplaint(world, id)).toMatchObject({ assigneeId: kavita().id, version: 1 });
  });
});

describe("CL3 status, comment and category", () => {
  it("CL3 IN_PROGRESS, then mark resolved: PENDING_CONFIRMATION with its time, events with the note, an audit row each", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    ok(await setStatus({ db: db(), user: kavita(), id, status: "IN_PROGRESS", note: "  Plumber booked ", expectedVersion: 1, now: NOW + 1000 }));
    expect(await setStatus({ db: db(), user: kavita(), id, status: "IN_PROGRESS", expectedVersion: 2, now: NOW + 2000 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    const result = ok(await setStatus({ db: db(), user: kavita(), id, status: "PENDING_CONFIRMATION", expectedVersion: 2, now: NOW + 3000 }));
    expect(result.complaint).toMatchObject({ status: "PENDING_CONFIRMATION", version: 3 });
    const saved = await loadComplaint(world, id);
    expect(saved.pendingConfirmationAt?.getTime()).toBe(NOW + 3000);
    expect(saved.events.filter((e) => e.eventType === "STATUS_CHANGED").map((e) => e.payload)).toEqual([
      { from: "ASSIGNED", to: "IN_PROGRESS", note: "Plumber booked" },
      { from: "IN_PROGRESS", to: "PENDING_CONFIRMATION", note: null },
    ]);
    expect(await world.ownerPrisma.auditLog.count({ where: { entityId: id, action: "COMPLAINT_STATUS_CHANGED" } })).toBe(2);
  });

  it("CL3 a safety complaint cannot be marked resolved by staff; a note over 500 characters is VALIDATION; a stale version is STALE", async () => {
    const r = await makeResident(world);
    const safety = await raise(r, "gas leak in the corridor");
    expect(await setStatus({ db: db(), user: kavita(), id: safety, status: "PENDING_CONFIRMATION", expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    const id = await raise(r, "Water leak under the sink");
    expect(await setStatus({ db: db(), user: kavita(), id, status: "IN_PROGRESS", note: "x".repeat(501), expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await setStatus({ db: db(), user: kavita(), id, status: "CLOSED" as never, expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await setStatus({ db: db(), user: kavita(), id, status: "IN_PROGRESS", expectedVersion: 5, now: NOW })).toEqual({ status: "ERROR", error: "STALE" });
    expect(await loadComplaint(world, id)).toMatchObject({ status: "ASSIGNED", version: 1 });
  });

  it("CL3 a comment marked visible shows to the resident, an internal one does not; a comment does not change the version", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    ok(await addComment({ db: db(), user: kavita(), id, text: " The plumber visits tomorrow ", visibleToResident: true, now: NOW + 1000 }));
    ok(await addComment({ db: db(), user: kavita(), id, text: "internal: vendor is slow", visibleToResident: false, now: NOW + 2000 }));
    expect((await loadComplaint(world, id)).version).toBe(1);
    const detail = await getComplaint({ db: db(), user: r.user, id, now: NOW + 3000 });
    if (detail.status !== "OK") throw new Error(detail.error);
    expect(detail.complaint.timeline.filter((t) => t.kind === "COMMENT").map((t) => t.text)).toEqual(["The plumber visits tomorrow"]);
    expect(JSON.stringify(detail)).not.toContain("vendor");
    for (const text of ["", "   ", "x".repeat(1001)]) expect(await addComment({ db: db(), user: kavita(), id, text, visibleToResident: true, now: NOW }), text.slice(0, 3)).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await addComment({ db: db(), user: kavita(), id, text: "ok", visibleToResident: "yes" as never, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await addComment({ db: db(), user: kavita(), id: "00000000-0000-4000-8000-000000000000", text: "ok", visibleToResident: true, now: NOW })).toEqual({ status: "ERROR", error: "NOT_FOUND" });
  });

  it("CL3 correcting the category: a CATEGORY_CORRECTED event, a MANUAL classifications row, needs_review cleared, the version raised", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Please look into the matter soon", new FakeClassifier());
    expect(await loadComplaint(world, id)).toMatchObject({ needsReview: true, categoryId: null, status: "NEW" });
    const result = ok(await correctCategory({ db: db(), user: kavita(), id, category: "ELECTRICAL", expectedVersion: 1, now: NOW + 1000 }));
    expect(result.complaint.version).toBe(2);
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ needsReview: false, category: { code: "ELECTRICAL" } });
    expect(saved.events.at(-1)).toMatchObject({ eventType: "CATEGORY_CORRECTED", actorId: kavita().id, payload: { from: null, to: "ELECTRICAL" } });
    expect(saved.classifications.map((c) => c.source).sort()).toEqual(["FALLBACK", "MANUAL"]);
    const manual = saved.classifications.find((c) => c.source === "MANUAL");
    expect(manual).toMatchObject({ categoryId: saved.categoryId, urgency: "NORMAL", confidence: null });
    expect(manual?.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await correctCategory({ db: db(), user: kavita(), id, category: "ELECTRICAL", expectedVersion: 2, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await correctCategory({ db: db(), user: kavita(), id, category: "GARDEN", expectedVersion: 2, now: NOW })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await correctCategory({ db: db(), user: kavita(), id, category: "LIFT", expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "STALE" });
    expect(ok(await correctCategory({ db: db(), user: kavita(), id, category: "LIFT", expectedVersion: 2, now: NOW + 2000 })).complaint.version).toBe(3);
    expect((await loadComplaint(world, id)).events.at(-1)?.payload).toEqual({ from: "ELECTRICAL", to: "LIFT" });
  });

  it("CL3 every staff action is FORBIDDEN without complaints:manage, and changes nothing", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    for (const user of [world.staff.priya, r.user]) {
      expect(await assign({ db: db(), user, id, assigneeUserId: kavita().id, expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await setStatus({ db: db(), user, id, status: "IN_PROGRESS", expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await addComment({ db: db(), user, id, text: "hello", visibleToResident: true, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await correctCategory({ db: db(), user, id, category: "LIFT", expectedVersion: 1, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    }
    expect(await loadComplaint(world, id)).toMatchObject({ version: 1, status: "ASSIGNED", firstResponseAt: null });
    expect((await loadComplaint(world, id)).events).toHaveLength(3);
  });

  it("CL3 a staff user whose permission was removed after sign-in is refused: the service checks the permission it is given each time", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    expect(await setStatus({ db: db(), user: { ...kavita(), permissions: [] }, id, status: "IN_PROGRESS", expectedVersion: 1, now: NOW + DAY })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await setStatus({ db: db(), user: { ...kavita(), active: false }, id, status: "IN_PROGRESS", expectedVersion: 1, now: NOW + DAY })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
  });
});
