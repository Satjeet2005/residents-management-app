import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LifecycleAction, type LifecycleState, applyTransition } from "@/domain/complaints/lifecycle";
import { createPrng } from "@/domain/seed/prng";
import { autoCloseDue } from "@/server/complaints/auto-close";
import { NO_FILTERS } from "@/lib/staff-complaints/board-query";
import { listBoardView } from "@/server/complaints/board-views";
import { createComplaint } from "@/server/complaints/create";
import { getComplaint, listOwnComplaints } from "@/server/complaints/read";
import { confirmFixed, reopen } from "@/server/complaints/resident";
import { acknowledgeSafety, closeSafety } from "@/server/complaints/safety";
import { addComment, assign, correctCategory, setStatus } from "@/server/complaints/staff-actions";
import { getStaffComplaint } from "@/server/complaints/staff-read";
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
const raise = async (r: Resident, body: string, at = NOW) => {
  const result = await createComplaint({ db: db(), user: r.user, body, now: at, classifier: new FakeClassifier({ result: arm("PLUMBING") }) });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint.id;
};

describe("CL3 everything runs as the APP role", () => {
  it("CL3 the connection is the app role, which cannot change a complaint's text, delete anything or touch the append-only events", async () => {
    const who = await db().$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
    expect(who[0].user).toBe(world.role.name);
    const r = await makeResident(world);
    const id = await raise(r, "Water leak under the sink");
    await expect(db().$executeRaw`UPDATE complaints SET body = 'changed' WHERE id = ${id}::uuid`).rejects.toThrow(/permission denied/i);
    await expect(db().$executeRaw`UPDATE complaints SET safety_flag = true WHERE id = ${id}::uuid`).rejects.toThrow(/permission denied/i);
    await expect(db().$executeRaw`DELETE FROM complaints WHERE id = ${id}::uuid`).rejects.toThrow(/permission denied/i);
    await expect(db().$executeRaw`UPDATE complaint_events SET payload = '{}'::jsonb WHERE complaint_id = ${id}::uuid`).rejects.toThrow(/permission denied/i);
    await expect(db().$executeRaw`DELETE FROM classifications WHERE complaint_id = ${id}::uuid`).rejects.toThrow(/permission denied/i);
    expect(await loadComplaint(world, id)).toMatchObject({ body: "Water leak under the sink", safetyFlag: false });
  });
});

describe("CL6 concurrency", () => {
  it("CL6 two staff assigning at once from the same version: exactly one wins, the other is STALE, and the complaint is consistent (10 rounds)", async () => {
    const r = await makeResident(world);
    for (let round = 0; round < 10; round++) {
      const id = await raise(r, `Water leak under the sink, round ${round}`, NOW + round * 120_000);
      const results = await Promise.all([
        assign({ db: db(), user: world.staff.kavita, id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 1, now: NOW + 10_000 }),
        assign({ db: db(), user: world.staff.sanjay, id, assigneeUserId: world.staff.kavita.id, expectedVersion: 1, now: NOW + 10_000 }),
      ]);
      expect(results.map((x) => x.status).sort(), `round ${round}`).toEqual(["ERROR", "OK"]);
      expect(results.filter((x) => x.status === "ERROR")).toEqual([{ status: "ERROR", error: "STALE" }]);
      const winner = results.find((x) => x.status === "OK");
      const saved = await loadComplaint(world, id);
      expect(saved.version).toBe(2);
      expect(winner?.status === "OK" && winner.complaint.assigneeId).toBe(saved.assigneeId);
      expect(saved.events.filter((e) => e.eventType === "ASSIGNED")).toHaveLength(2);
      expect(await world.ownerPrisma.auditLog.count({ where: { entityId: id, action: "COMPLAINT_ASSIGNED" } })).toBe(1);
    }
  });

  it("CL6 a resident's confirm racing the auto-close ends consistent: closed once, by one of them, with the matching close kind and rating (10 rounds)", async () => {
    const r = await makeResident(world);
    const outcomes = new Set<string>();
    for (let round = 0; round < 10; round++) {
      const id = await raise(r, `Corridor light is out, round ${round}`, NOW - 20 * DAY + round * 120_000);
      await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 7 * DAY), firstResponseAt: new Date(NOW - 8 * DAY) });
      const [confirmed, closedCount] = await Promise.all([confirmFixed({ db: db(), user: r.user, id, rating: 5, now: NOW }), autoCloseDue({ db: db(), now: NOW })]);
      const saved = await loadComplaint(world, id);
      expect(saved.status, `round ${round}`).toBe("CLOSED");
      expect(saved.events.filter((e) => e.eventType === "CLOSED"), `round ${round}`).toHaveLength(1);
      if (confirmed.status === "OK") {
        expect(saved).toMatchObject({ closeKind: "CONFIRMED", rating: 5 });
        outcomes.add("confirm");
      } else {
        expect(confirmed).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
        expect(saved).toMatchObject({ closeKind: "AUTO_CLOSED", rating: null });
        outcomes.add("auto");
      }
      expect(closedCount >= 1 || confirmed.status === "OK", `round ${round}`).toBe(true);
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it("CL6 two residents' confirms of one complaint at once: one OK, one INVALID_TRANSITION, one CLOSED event", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "Dustbin is overflowing");
    await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW), firstResponseAt: new Date(NOW) });
    const results = await Promise.all([confirmFixed({ db: db(), user: r.user, id, rating: 4, now: NOW }), confirmFixed({ db: db(), user: r.user, id, rating: 1, now: NOW })]);
    expect(results.map((x) => x.status).sort()).toEqual(["ERROR", "OK"]);
    expect((await loadComplaint(world, id)).events.filter((e) => e.eventType === "CLOSED")).toHaveLength(1);
  });
});

describe("CL1 the lifecycle agrees with the real database checks", () => {
  it("CL1 60 seeded random action sequences, written to the database after each step, never violate K1 to K4 (the database would refuse the row)", async () => {
    const r = await makeResident(world);
    const rng = createPrng(777);
    let steps = 0;
    for (let run = 0; run < 60; run++) {
      const g = rng.fork(`db:${run}`);
      const safety = g.chance(0.4);
      const id = await raise(r, safety ? `There is a fire in tower ${run}` : `Water leak under the sink ${run}`, NOW + run * 1000);
      let state: LifecycleState = { ...(await loadLifecycle(id)), safetyFlag: safety };
      let now = NOW + run * 1000;
      for (let step = 0; step < 8; step++) {
        now += g.pick([1000, 3_600_000, DAY, 8 * DAY]);
        const kind = g.pick(["ASSIGN", "START", "MARK_RESOLVED", "RESPOND", "CONFIRM", "REOPEN", "AUTO_CLOSE", "CLOSE_SAFETY"] as const);
        const action: LifecycleAction = kind === "CONFIRM" ? { kind, rating: g.int(1, 5) } : kind === "REOPEN" ? { kind, reason: "Still not fixed" } : { kind };
        const result = applyTransition(state, action, now);
        if (!result.ok) continue;
        state = { ...state, ...result.fields };
        steps++;
        await world.ownerPrisma.complaint.update({
          where: { id },
          data: {
            status: state.status,
            closedAt: state.closedAt === null ? null : new Date(state.closedAt),
            closeKind: state.closeKind,
            pendingConfirmationAt: state.pendingConfirmationAt === null ? null : new Date(state.pendingConfirmationAt),
            rating: state.rating,
            reopenCount: state.reopenCount,
            firstResponseAt: state.firstResponseAt === null ? null : new Date(state.firstResponseAt),
          },
        });
      }
    }
    expect(steps).toBeGreaterThan(150);
  }, 30_000);
});
async function loadLifecycle(id: string): Promise<Omit<LifecycleState, "safetyFlag">> {
  const row = await loadComplaint(world, id);
  return { status: row.status, closedAt: null, closeKind: null, pendingConfirmationAt: null, reopenCount: 0, rating: null, firstResponseAt: null };
}

describe("end to end: the complaint loop and the safety loop", () => {
  it("CL4 a plain complaint: raised, on the board, assigned, in progress, marked resolved, confirmed with a rating; the resident sees each step", async () => {
    const r = await makeResident(world);
    const raised = await createComplaint({ db: db(), user: r.user, body: "Water leak under the sink", now: NOW, classifier: new FakeClassifier({ result: arm("PLUMBING", 0.9, "HIGH") }) });
    if (raised.status !== "OK") throw new Error(raised.error);
    const id = raised.complaint.id;
    expect(raised.complaint).toMatchObject({ urgency: "HIGH", category: "PLUMBING", status: "ASSIGNED" });

    const lane = await listBoardView({ db: db(), user: world.staff.kavita, view: "open", filters: NO_FILTERS, limit: 50, now: NOW });
    if (lane.status !== "OK") throw new Error(lane.error);
    expect(lane.rows.find((x) => x.id === id)).toMatchObject({ assignee: { name: "Kavita Rao" }, urgency: "HIGH", sla: "ON_TIME" });

    await assign({ db: db(), user: world.staff.kavita, id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 1, now: NOW + 60_000 });
    await addComment({ db: db(), user: world.staff.sanjay, id, text: "Plumber booked for 4 pm", visibleToResident: true, now: NOW + 120_000 });
    await setStatus({ db: db(), user: world.staff.sanjay, id, status: "IN_PROGRESS", expectedVersion: 2, now: NOW + 180_000 });
    await setStatus({ db: db(), user: world.staff.sanjay, id, status: "PENDING_CONFIRMATION", note: "Pipe replaced", expectedVersion: 3, now: NOW + 240_000 });
    const waiting = await listOwnComplaints({ db: db(), user: r.user, now: NOW + 300_000 });
    expect(waiting).toMatchObject({ status: "OK", complaints: [{ id, status: "PENDING_CONFIRMATION", needsAnswer: true, current: 3 }] });

    expect(await confirmFixed({ db: db(), user: r.user, id, rating: 5, now: NOW + 360_000 })).toMatchObject({ status: "OK", complaint: { status: "CLOSED", rating: 5 } });
    const detail = await getComplaint({ db: db(), user: r.user, id, now: NOW + 400_000 });
    if (detail.status !== "OK") throw new Error(detail.error);
    expect(detail.complaint.timeline.map((t) => t.label)).toEqual(["Raised", "Assigned", "Assigned", "Update from the society", "In progress", "Marked resolved. Please confirm or reopen", "Closed. You confirmed it is fixed"]);
    const full = await getStaffComplaint({ db: db(), user: world.staff.kavita, id });
    if (full.status !== "OK") throw new Error(full.error);
    expect(full.complaint).toMatchObject({ status: "CLOSED", closeKind: "CONFIRMED", rating: 5, version: 5 });
    expect(full.complaint.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ASSIGNED", "ASSIGNED", "COMMENT", "STATUS_CHANGED", "STATUS_CHANGED", "CLOSED"]);
    let cursor: string | undefined;
    let found = false;
    do {
      const closedPage = await listBoardView({ db: db(), user: world.staff.kavita, view: "closed", filters: NO_FILTERS, cursor, limit: 50, now: NOW + 400_000 });
      if (closedPage.status !== "OK") throw new Error(closedPage.error);
      found = found || closedPage.rows.some((x) => x.id === id);
      cursor = closedPage.nextCursor ?? undefined;
    } while (cursor !== undefined && !found);
    expect(found).toBe(true);
  });

  it("CL4 a complaint with no category: triage, a person corrects the category and assigns, the resident reopens after the first resolution and it is resolved again", async () => {
    const r = await makeResident(world);
    const result = await createComplaint({ db: db(), user: r.user, body: "Please look into the matter soon", now: NOW, classifier: new FakeClassifier() });
    if (result.status !== "OK") throw new Error(result.error);
    const id = result.complaint.id;
    const triage = await listBoardView({ db: db(), user: world.staff.kavita, view: "triage", filters: NO_FILTERS, limit: 50, now: NOW });
    expect(triage.status === "OK" && triage.rows.some((x) => x.id === id)).toBe(true);
    await correctCategory({ db: db(), user: world.staff.kavita, id, category: "HOUSEKEEPING", expectedVersion: 1, now: NOW + 1000 });
    await assign({ db: db(), user: world.staff.kavita, id, assigneeUserId: world.staff.kavita.id, expectedVersion: 2, now: NOW + 2000 });
    await setStatus({ db: db(), user: world.staff.kavita, id, status: "PENDING_CONFIRMATION", expectedVersion: 3, now: NOW + 3000 });
    expect(await reopen({ db: db(), user: r.user, id, reason: "Nobody came to check", now: NOW + 4000 })).toMatchObject({ status: "OK", complaint: { status: "REOPENED", reopenCount: 1 } });
    await assign({ db: db(), user: world.staff.kavita, id, assigneeUserId: world.staff.sanjay.id, expectedVersion: 4, now: NOW + 5000 });
    await setStatus({ db: db(), user: world.staff.sanjay, id, status: "PENDING_CONFIRMATION", expectedVersion: 5, now: NOW + 6000 });
    expect(await autoCloseDue({ db: db(), now: NOW + 6000 + 7 * DAY })).toBeGreaterThanOrEqual(1);
    expect(await loadComplaint(world, id)).toMatchObject({ status: "CLOSED", closeKind: "AUTO_CLOSED", reopenCount: 1, rating: null });
  });

  it("CL3 a safety complaint: SAFETY lane for the duty manager, acknowledged, closed by the duty manager, and the resident may dispute the closure", async () => {
    const r = await makeResident(world);
    const id = await raise(r, "There is a gas leak in the corridor");
    const lane = await listBoardView({ db: db(), user: world.staff.sanjay, view: "safety", filters: NO_FILTERS, limit: 50, now: NOW + 60_000 });
    if (lane.status !== "OK") throw new Error(lane.error);
    expect(lane.rows.find((x) => x.id === id)).toMatchObject({ assignee: { name: "Sanjay Pawar" }, urgency: "CRITICAL", sla: "ON_TIME" });
    expect(await acknowledgeSafety({ db: db(), user: world.staff.sanjay, id, now: NOW + 120_000 })).toMatchObject({ status: "OK" });
    expect(await setStatus({ db: db(), user: world.staff.sanjay, id, status: "PENDING_CONFIRMATION", expectedVersion: 1, now: NOW + 130_000 })).toEqual({ status: "ERROR", error: "INVALID_TRANSITION" });
    expect(await closeSafety({ db: db(), user: world.staff.sanjay, id, note: "Gas isolated, area ventilated", now: NOW + 600_000 })).toMatchObject({ status: "OK" });
    const after = await listBoardView({ db: db(), user: world.staff.sanjay, view: "safety", filters: NO_FILTERS, limit: 50, now: NOW + 700_000 });
    expect(after.status === "OK" && after.rows.some((x) => x.id === id)).toBe(false);
    expect(await reopen({ db: db(), user: r.user, id, reason: "I can still smell gas", now: NOW + DAY })).toMatchObject({ status: "OK", complaint: { status: "REOPENED" } });
    const back = await listBoardView({ db: db(), user: world.staff.sanjay, view: "safety", filters: NO_FILTERS, limit: 50, now: NOW + DAY });
    expect(back.status === "OK" && back.rows.some((x) => x.id === id)).toBe(true);
    await autoCloseDue({ db: db(), now: NOW + 365 * DAY });
    expect(await loadComplaint(world, id)).toMatchObject({ status: "REOPENED", closeKind: null, safetyFlag: true });
  });
});
