import { slaOutcome } from "@/domain/complaints/sla";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LANES, type Lane, listBoard } from "@/server/complaints/board";
import { createComplaint } from "@/server/complaints/create";
import { getStaffComplaint, listStaffUsers } from "@/server/complaints/staff-read";
import { DAY, FakeClassifier, NOW, type World, arm, arrange, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
const ids: Record<string, string> = {};
const MIN = 60_000;

const raise = async (name: string, body: string, at: number, classifier = new FakeClassifier({ result: arm("PLUMBING") })) => {
  const resident = await makeResident(world);
  const result = await createComplaint({ db: world.appPrisma, user: resident.user, body, now: at, classifier });
  if (result.status !== "OK") throw new Error(result.error);
  ids[name] = result.complaint.id;
  return { id: result.complaint.id, flatCode: resident.flat.code };
};
const flats: Record<string, string> = {};

beforeAll(async () => {
  world = await setupWorld();
  flats.triage = (await raise("triage", "Please look into the matter soon", NOW - 10 * MIN, new FakeClassifier())).flatCode;
  await raise("assigned", "Water leak under the sink", NOW - 20 * MIN);
  const progress = await raise("progress", "Tap in the kitchen leaks", NOW - 30 * MIN);
  await arrange(world, progress.id, { status: "IN_PROGRESS", firstResponseAt: new Date(NOW - 25 * MIN) });
  await raise("overdue", "Tap in the bathroom leaks", NOW - 2 * DAY);
  const waiting = await raise("waiting", "Drain is blocked", NOW - 3 * 3600_000);
  await arrange(world, waiting.id, { status: "PENDING_CONFIRMATION", firstResponseAt: new Date(NOW - 2 * 3600_000), pendingConfirmationAt: new Date(NOW - 3600_000) });
  const late = await raise("late", "Drain is blocked again", NOW - 3 * DAY);
  await arrange(world, late.id, { status: "PENDING_CONFIRMATION", firstResponseAt: new Date(NOW - 3 * DAY + MIN), pendingConfirmationAt: new Date(NOW - DAY) });
  await raise("safety", "There is a gas leak in the corridor", NOW - 3600_000);
  const closed = await raise("closed", "Pipe repaired already", NOW - 5 * DAY);
  await arrange(world, closed.id, { status: "CLOSED", closedAt: new Date(NOW - DAY), closeKind: "CONFIRMED", firstResponseAt: new Date(NOW - 5 * DAY + MIN) });
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const board = async (lane: Lane, extra: { cursor?: string; limit?: number } = {}) => {
  const result = await listBoard({ db: world.appPrisma, user: world.staff.kavita, lane, now: NOW, ...extra });
  if (result.status !== "OK") throw new Error(result.error);
  return result;
};
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const named = (...names: string[]) => names.map((n) => ids[n]).sort();

describe("CL3 the staff board lanes", () => {
  it("CL3 each lane holds exactly what its rule says, and the counts are per lane", async () => {
    const expected: Record<Lane, string[]> = {
      NEEDS_TRIAGE: ["triage"],
      OPEN: ["assigned", "progress", "overdue", "safety"],
      OVERDUE: ["overdue", "safety"],
      WAITING_RESIDENT: ["waiting", "late"],
      SAFETY: ["safety"],
      CLOSED: ["closed"],
    };
    for (const lane of LANES) {
      const result = await board(lane);
      expect(idsOf(result.rows), lane).toEqual(named(...expected[lane]));
      expect(result.counts[lane], lane).toBe(expected[lane].length);
      expect(result.nextCursor).toBeNull();
    }
    expect((await board("OPEN")).counts).toEqual({ NEEDS_TRIAGE: 1, OPEN: 4, OVERDUE: 2, WAITING_RESIDENT: 2, SAFETY: 1, CLOSED: 1 });
  });

  it("CL3 a reopened complaint is in OPEN, and a complaint with a category but no assignee is in NEEDS_TRIAGE", async () => {
    const reopened = await raise("reopened", "Tap in the passage leaks", NOW - 4 * 3600_000);
    await arrange(world, reopened.id, { status: "REOPENED", reopenCount: 1, firstResponseAt: new Date(NOW - 3 * 3600_000) });
    const orphan = await raise("orphan", "Tap on the terrace leaks", NOW - 4 * 3600_000);
    await arrange(world, orphan.id, { assigneeId: null, status: "NEW" });
    expect(idsOf((await board("OPEN")).rows)).toContain(reopened.id);
    expect(idsOf((await board("NEEDS_TRIAGE")).rows)).toEqual(named("triage", "orphan"));
    await arrange(world, reopened.id, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED", reopenCount: 1 });
    await arrange(world, orphan.id, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED", needsReview: false });
  });

  it("D151 NEEDS_TRIAGE is not closed and (no assignee, or NEW with needs_review): assigned, in-progress and waiting complaints are never in it, even with needs_review", async () => {
    const kinds: [string, Parameters<typeof arrange>[2]][] = [
      ["t1", { assigneeId: null, status: "NEW", needsReview: false }],
      ["t2", { status: "NEW", needsReview: true }],
      ["t3", { status: "ASSIGNED", needsReview: true }],
      ["t4", { status: "IN_PROGRESS", needsReview: true }],
      ["t5", { status: "PENDING_CONFIRMATION", needsReview: true, pendingConfirmationAt: new Date(NOW - MIN), firstResponseAt: new Date(NOW - 2 * MIN) }],
      ["t6", { status: "REOPENED", needsReview: true, reopenCount: 1, firstResponseAt: new Date(NOW - 2 * MIN) }],
      ["t7", { assigneeId: null, status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED" }],
    ];
    for (const [name, data] of kinds) await arrange(world, (await raise(name, `Tap ${name} leaks`, NOW - 8 * MIN)).id, data);
    const triage = idsOf((await board("NEEDS_TRIAGE")).rows);
    expect(triage).toEqual(named("triage", "t1", "t2"));
    const [{ n }] = await world.ownerPrisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM complaints WHERE status <> 'CLOSED' AND (assignee_id IS NULL OR (needs_review AND status = 'NEW'))`;
    expect((await board("NEEDS_TRIAGE")).counts.NEEDS_TRIAGE).toBe(n);
    for (const [name] of kinds) await arrange(world, ids[name], { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED", needsReview: false });
  });

  it("D150 a late first reply is LATE, not OVERDUE and not MET; the OVERDUE lane is exactly the complaints slaOutcome calls MISSED_OPEN", async () => {
    const lateReply = await raise("lateReply", "Tap in the garage leaks", NOW - 3 * DAY);
    await arrange(world, lateReply.id, { firstResponseAt: new Date(NOW - 3 * DAY + 1441 * MIN) });
    const row = (await board("OPEN")).rows.find((r) => r.id === lateReply.id);
    expect(row?.sla).toBe("LATE");
    const all = await world.ownerPrisma.complaint.findMany({ select: { id: true, status: true, responseDueAt: true, firstResponseAt: true } });
    const missedOpen = all
      .filter((c) => c.status !== "CLOSED" && slaOutcome({ responseDueAt: c.responseDueAt?.getTime() ?? null, firstResponseAt: c.firstResponseAt?.getTime() ?? null, now: NOW }) === "MISSED_OPEN")
      .map((c) => c.id)
      .sort();
    expect(idsOf((await board("OVERDUE")).rows)).toEqual(missedOpen);
    expect(missedOpen).not.toContain(lateReply.id);
    await arrange(world, lateReply.id, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED" });
  });

  it("CL3 a row has the flat code, category, urgency, status, assignee, age, SLA state and the source of the classification", async () => {
    const rows = (await board("SAFETY")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ids.safety, urgency: "CRITICAL", status: "ASSIGNED", safety: true, assignee: { id: world.staff.sanjay.id, name: "Sanjay Pawar" }, ageMinutes: 60, sla: "OVERDUE", source: "RULE", category: "PLUMBING" });
    expect(rows[0].flatCode).toMatch(/^Z/);
    const triage = (await board("NEEDS_TRIAGE")).rows.find((r) => r.id === ids.triage);
    expect(triage).toMatchObject({ category: null, assignee: null, status: "NEW", needsReview: true, source: "FALLBACK", sla: "ON_TIME", title: "Please look into the matter soon" });
    expect((await board("WAITING_RESIDENT")).rows.find((r) => r.id === ids.waiting)).toMatchObject({ sla: "MET", status: "PENDING_CONFIRMATION" });
    expect((await board("WAITING_RESIDENT")).rows.find((r) => r.id === ids.late)?.sla).toBe("MET");
    expect((await board("CLOSED")).rows[0]).toMatchObject({ sla: "NONE", status: "CLOSED" });
  });

  it("CL3 keyset pagination: pages of 2 are newest first, complete, without repeats, and the last page has no cursor", async () => {
    for (let i = 0; i < 4; i++) await raise(`p${i}`, `Tap number ${i} leaks`, NOW - (i + 1) * MIN);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await board("OPEN", { cursor, limit: 2 });
      expect(page.rows.length).toBeLessThanOrEqual(2);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor !== undefined && pages < 20);
    const all = (await board("OPEN", { limit: 50 })).rows;
    expect(seen).toEqual(all.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBe(Math.ceil(all.length / 2));
    const times = all.map((r) => r.ageMinutes);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("CL3 a cursor that is not ours, an unknown lane and a limit outside 1 to 50 are VALIDATION", async () => {
    const base = { db: world.appPrisma, user: world.staff.kavita, now: NOW };
    for (const cursor of ["x", "e30", Buffer.from('{"t":"nope","id":"x"}').toString("base64url"), Buffer.from(JSON.stringify({ t: "2026-13-45 99:99:99+00", id: "00000000-0000-4000-8000-000000000000" })).toString("base64url")]) expect(await listBoard({ ...base, lane: "OPEN", cursor })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await listBoard({ ...base, lane: "ALL" as Lane })).toEqual({ status: "ERROR", error: "VALIDATION" });
    for (const limit of [0, 51, 1.5]) expect(await listBoard({ ...base, lane: "OPEN", limit })).toEqual({ status: "ERROR", error: "VALIDATION" });
  });

  it("CL3 staff without complaints:manage, the accounts user and residents get FORBIDDEN from every staff read", async () => {
    const resident = (await makeResident(world)).user;
    for (const user of [world.staff.priya, resident]) {
      expect(await listBoard({ db: world.appPrisma, user, lane: "OPEN", now: NOW }), user.name).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await getStaffComplaint({ db: world.appPrisma, user, id: ids.safety }), user.name).toEqual({ status: "ERROR", error: "FORBIDDEN" });
      expect(await listStaffUsers({ db: world.appPrisma, user }), user.name).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    }
  });
});

describe("CL3 the staff detail and the staff list", () => {
  it("CL3 the detail has the full timeline, with CLASSIFIED and the actors, and the classification history", async () => {
    const result = await getStaffComplaint({ db: world.appPrisma, user: world.staff.kavita, id: ids.safety });
    if (result.status !== "OK") throw new Error(result.error);
    const c = result.complaint;
    expect(c).toMatchObject({ body: "There is a gas leak in the corridor", safety: true, urgency: "CRITICAL", version: 1, assignee: { name: "Sanjay Pawar" }, language: "LATIN", raisedBy: "Swati Joshi" });
    expect(c.events.map((e) => e.eventType)).toEqual(["CREATED", "CLASSIFIED", "ESCALATED", "ASSIGNED"]);
    expect(c.events[0].actor).toMatchObject({ name: "Swati Joshi" });
    expect(c.classifications).toHaveLength(1);
    expect(c.classifications[0]).toMatchObject({ source: "RULE", category: "PLUMBING", urgency: "CRITICAL", confidence: null });
    expect(await getStaffComplaint({ db: world.appPrisma, user: world.staff.kavita, id: "00000000-0000-4000-8000-000000000000" })).toEqual({ status: "ERROR", error: "NOT_FOUND" });
    expect(await getStaffComplaint({ db: world.appPrisma, user: world.staff.kavita, id: "nope" })).toEqual({ status: "ERROR", error: "NOT_FOUND" });
  });

  it("CL3 the staff list is the active staff who hold complaints:manage, by name", async () => {
    const result = await listStaffUsers({ db: world.appPrisma, user: world.staff.kavita });
    expect(result).toEqual({ status: "OK", users: [{ id: world.staff.kavita.id, name: "Kavita Rao" }, { id: world.staff.sanjay.id, name: "Sanjay Pawar" }] });
  });
});
