import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createComplaint } from "@/server/complaints/create";
import { getComplaint, listOwnComplaints } from "@/server/complaints/read";
import { confirmFixed, reopen } from "@/server/complaints/resident";
import { DAY, FakeClassifier, NOW, type World, arm, arrange, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
beforeAll(async () => {
  world = await setupWorld();
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

type Resident = Awaited<ReturnType<typeof makeResident>>;
const raise = async (r: Resident, body: string, now = NOW) => {
  const result = await createComplaint({ db: world.appPrisma, user: r.user, body, now, classifier: new FakeClassifier({ result: arm("PLUMBING") }) });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint.id;
};
const db = () => world.appPrisma;
/** A complaint waiting for the resident's answer since `since`. */
const pendingSince = async (r: Resident, since: number, body = "Water leak under the sink") => {
  const id = await raise(r, body, since - DAY);
  await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(since), firstResponseAt: new Date(since - DAY / 2) });
  return id;
};

describe("CL4 confirm", () => {
  it("CL4 confirm closes the complaint CONFIRMED, with an optional rating, and records a CLOSED event", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    const result = await confirmFixed({ db: db(), user: r.user, id, rating: 4, now: NOW });
    expect(result).toEqual({ status: "OK", complaint: { id, status: "CLOSED", rating: 4, reopenCount: 0 } });
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ status: "CLOSED", closeKind: "CONFIRMED", rating: 4, version: 2 });
    expect(saved.closedAt?.getTime()).toBe(NOW);
    const closed = saved.events.at(-1);
    expect(closed).toMatchObject({ eventType: "CLOSED", actorId: r.user.id, payload: { closeKind: "CONFIRMED", rating: 4 } });

    const other = await pendingSince(r, NOW - DAY, "Gate light is out");
    expect(await confirmFixed({ db: db(), user: r.user, id: other, now: NOW })).toMatchObject({ status: "OK", complaint: { rating: null } });
  });

  it("CL4 a rating outside 1 to 5, or not a whole number, is VALIDATION and nothing changes", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    for (const rating of [0, 6, 2.5, -1]) expect(await confirmFixed({ db: db(), user: r.user, id, rating, now: NOW }), String(rating)).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await loadComplaint(world, id)).toMatchObject({ status: "PENDING_CONFIRMATION", version: 1, rating: null });
  });

  it("CL4 a repeated confirm is refused (INVALID_TRANSITION, the route's 409) and changes nothing", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    expect(await confirmFixed({ db: db(), user: r.user, id, rating: 5, now: NOW })).toMatchObject({ status: "OK" });
    expect(await confirmFixed({ db: db(), user: r.user, id, rating: 1, now: NOW + 1000 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ rating: 5, version: 2 });
    expect(saved.events.filter((e) => e.eventType === "CLOSED")).toHaveLength(1);
  });

  it("CL4 a complaint that is not waiting for an answer cannot be confirmed", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    expect(await confirmFixed({ db: db(), user: r.user, id, now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
  });
});

describe("CL4 reopen", () => {
  it("CL4 reopen needs a reason of 5 to 500 characters", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    for (const reason of ["", "no", "    ab   ", "x".repeat(501)]) expect(await reopen({ db: db(), user: r.user, id, reason, now: NOW }), reason.slice(0, 5)).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await loadComplaint(world, id)).toMatchObject({ status: "PENDING_CONFIRMATION", reopenCount: 0, version: 1 });
  });

  it("CL4 reopen from PENDING_CONFIRMATION: REOPENED, reopen_count + 1, closure fields cleared, an event with the reason", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    expect(await reopen({ db: db(), user: r.user, id, reason: "  Still leaking after the visit ", now: NOW })).toMatchObject({ status: "OK", complaint: { status: "REOPENED", reopenCount: 1 } });
    const saved = await loadComplaint(world, id);
    expect(saved).toMatchObject({ status: "REOPENED", reopenCount: 1, closedAt: null, closeKind: null, pendingConfirmationAt: null, rating: null, version: 2 });
    expect(saved.events.at(-1)).toMatchObject({ eventType: "REOPENED", actorId: r.user.id, payload: { reason: "Still leaking after the visit", reopenCount: 1 } });
  });

  it("CL4 a closed complaint can be reopened, its rating cleared, within 7 days and not after", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - 10 * DAY);
    await confirmFixed({ db: db(), user: r.user, id, rating: 5, now: NOW - 9 * DAY });
    expect(await reopen({ db: db(), user: r.user, id, reason: "Leak is back", now: NOW - 9 * DAY + 7 * DAY + 1 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    expect(await reopen({ db: db(), user: r.user, id, reason: "Leak is back", now: NOW - 9 * DAY + 7 * DAY })).toMatchObject({ status: "OK", complaint: { status: "REOPENED", rating: null, reopenCount: 1 } });
    expect(await loadComplaint(world, id)).toMatchObject({ closedAt: null, closeKind: null, rating: null });
  });

  it("CL4 a reopen of a safety complaint closed by the duty manager is allowed within the window (the resident may dispute)", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "gas leak in the corridor");
    await arrange(world, id, { status: "CLOSED", closedAt: new Date(NOW - DAY), closeKind: "DUTY_MANAGER", firstResponseAt: new Date(NOW - DAY) });
    expect(await reopen({ db: db(), user: r.user, id, reason: "The smell is still here", now: NOW })).toMatchObject({ status: "OK", complaint: { status: "REOPENED" } });
    expect(await loadComplaint(world, id)).toMatchObject({ safetyFlag: true, urgency: "CRITICAL", closeKind: null });
  });

  it("CL4 a reopened complaint can be confirmed only after staff mark it resolved again (not straight from REOPENED)", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    await reopen({ db: db(), user: r.user, id, reason: "Still leaking", now: NOW });
    expect(await confirmFixed({ db: db(), user: r.user, id, now: NOW })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
  });
});

describe("CL3 a resident acts and reads only on their own flat", () => {
  it("CL3 another flat's complaint is NOT_FOUND for confirm, reopen and read, and exactly like a missing one", async () => {
    const mine = await makeResident(world);
    const theirs = await makeResident(world);
    const id = await pendingSince(theirs, NOW - DAY);
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const target of [id, missing, "not-a-uuid"]) {
      expect(await confirmFixed({ db: db(), user: mine.user, id: target, now: NOW }), target).toEqual({ status: "ERROR", error: "NOT_FOUND" });
      expect(await reopen({ db: db(), user: mine.user, id: target, reason: "Still leaking", now: NOW }), target).toEqual({ status: "ERROR", error: "NOT_FOUND" });
      expect(await getComplaint({ db: db(), user: mine.user, id: target, now: NOW }), target).toEqual({ status: "ERROR", error: "NOT_FOUND" });
    }
    expect(await loadComplaint(world, id)).toMatchObject({ status: "PENDING_CONFIRMATION", version: 1 });
  });

  it("CL3 staff, an inactive resident and a resident with no flat cannot use the resident calls", async () => {
    const r = await makeResident(world);
    const id = await pendingSince(r, NOW - DAY);
    expect(await confirmFixed({ db: db(), user: world.staff.kavita, id, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await listOwnComplaints({ db: db(), user: world.staff.sanjay, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await getComplaint({ db: db(), user: { ...r.user, active: false }, id, now: NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    await world.ownerPrisma.flatMember.updateMany({ where: { userId: r.user.id }, data: { endsOn: new Date("2026-02-01T00:00:00Z") } });
    expect(await listOwnComplaints({ db: db(), user: r.user, now: NOW })).toEqual({ status: "ERROR", error: "NO_FLAT" });
    expect(await getComplaint({ db: db(), user: r.user, id, now: NOW })).toEqual({ status: "ERROR", error: "NO_FLAT" });
  });
});

describe("CL3 reading complaints", () => {
  it("CL3 the list is the current flat's only, open first and newest first, with the Home's step and the reply-due line", async () => {
    const r = await makeResident(world);
    const other = await makeResident(world);
    await raise(other, "Someone else's complaint");
    const oldest = await raise(r, "First complaint about the lift lobby", NOW - 3 * DAY);
    const newest = await raise(r, "Second complaint about the tap", NOW - 2 * 3600_000);
    const closed = await raise(r, "Third complaint, already closed", NOW - DAY);
    await arrange(world, closed, { status: "CLOSED", closedAt: new Date(NOW - 3600_000), closeKind: "CONFIRMED", firstResponseAt: new Date(NOW - 7200_000) });
    const waiting = await raise(r, "Fourth complaint, waiting for me", NOW - 5 * 3600_000);
    await arrange(world, waiting, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 3600_000), firstResponseAt: new Date(NOW - 4 * 3600_000) });

    const list = await listOwnComplaints({ db: db(), user: r.user, now: NOW });
    if (list.status !== "OK") throw new Error(list.error);
    expect(list.complaints.map((c) => c.id)).toEqual([newest, waiting, oldest, closed]);
    const byId = Object.fromEntries(list.complaints.map((c) => [c.id, c]));
    expect(byId[newest]).toMatchObject({ title: "Second complaint about the tap", status: "ASSIGNED", current: 1, needsAnswer: false });
    expect(byId[newest].replyText).toMatch(/^Reply due /);
    expect(byId[oldest]).toMatchObject({ reply: { kind: "OVERDUE" }, replyText: "Reply overdue" });
    expect(byId[waiting]).toMatchObject({ status: "PENDING_CONFIRMATION", current: 3, needsAnswer: true, reply: null, replyText: null });
    expect(byId[closed]).toMatchObject({ status: "CLOSED", current: 3, reply: null, replyText: null });
  });

  it("CL3 the detail has the words, the flat, the rating and a timeline that hides CLASSIFIED, internal notes and names", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    await world.ownerPrisma.complaintEvent.createMany({
      data: [
        { complaintId: id, eventType: "COMMENT", actorId: world.staff.kavita.id, payload: { body: "Plumber visits tomorrow morning", visibleToResident: true }, createdAt: new Date(NOW + 1000) },
        { complaintId: id, eventType: "COMMENT", actorId: world.staff.kavita.id, payload: { body: "internal: vendor is unreliable", visibleToResident: false }, createdAt: new Date(NOW + 2000) },
        { complaintId: id, eventType: "STATUS_CHANGED", actorId: world.staff.kavita.id, payload: { from: "ASSIGNED", to: "IN_PROGRESS" }, createdAt: new Date(NOW + 3000) },
      ],
    });
    const result = await getComplaint({ db: db(), user: r.user, id, now: NOW + 10_000 });
    if (result.status !== "OK") throw new Error(result.error);
    expect(result.complaint).toMatchObject({ id, body: "Water leak under the sink", flatCode: r.flat.code, safety: false, canReopen: false });
    expect(result.complaint.timeline.map((t) => t.label)).toEqual(["Raised", "Assigned", "Update from the society", "In progress"]);
    const text = JSON.stringify(result.complaint);
    for (const hidden of ["internal", "vendor", "Kavita", world.staff.kavita.id, "LLM", "FALLBACK", "classif"]) expect(text, hidden).not.toContain(hidden);
  });

  it("CL3 a safety complaint's timeline says it was sent to the duty manager, and canReopen follows the status and the window", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "gas leak in the corridor");
    const detail = async (now: number) => {
      const result = await getComplaint({ db: db(), user: r.user, id, now });
      if (result.status !== "OK") throw new Error(result.error);
      return result.complaint;
    };
    expect((await detail(NOW)).timeline.map((t) => t.label)).toEqual(["Raised", "Sent to the duty manager"]);
    expect((await detail(NOW)).canReopen).toBe(false);
    await arrange(world, id, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "DUTY_MANAGER", firstResponseAt: new Date(NOW) });
    expect((await detail(NOW + 7 * DAY)).canReopen).toBe(true);
    expect((await detail(NOW + 7 * DAY + 1)).canReopen).toBe(false);
  });
});
