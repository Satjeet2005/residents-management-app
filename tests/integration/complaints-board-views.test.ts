import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOARD_VIEWS, type BoardView, type RankFacts, type ViewFacts, compareForView, inView } from "@/domain/complaints/board-views";
import { type BoardFilters, NO_FILTERS, parseBoardQuery } from "@/lib/staff-complaints/board-query";
import { type ViewBoard, listBoardView } from "@/server/complaints/board-views";
import type { Actor } from "@/server/complaints/context";
import { bestOfMsAsync } from "../helpers/best-of";
import { type SeededWorld, setupSeededWorld } from "./seeded-world";

/** 7 Nov 2026, 12:00 India time: the seed is dated 27 October, so many replies are overdue. */
const NOW = Date.UTC(2026, 10, 7, 6, 30, 0);
let world: SeededWorld;
beforeAll(async () => {
  world = await setupSeededWorld();
  // The seed has one open safety complaint and no acknowledgement. Add open safety complaints of different ages, the duty manager acknowledging two of them.
  const model = await world.ownerPrisma.complaint.findFirstOrThrow({ where: { status: "ASSIGNED" } });
  for (let i = 0; i < 5; i++) {
    const created = await world.ownerPrisma.complaint.create({
      data: { flatId: model.flatId, raisedById: model.raisedById, body: `Safety ${i}: gas smell in the corridor`, categoryId: model.categoryId, urgency: "CRITICAL", safetyFlag: true, status: "ASSIGNED", assigneeId: world.sanjay.id, createdAt: new Date(NOW - (i + 1) * 3600_000), responseDueAt: new Date(NOW - (i + 1) * 3600_000 + 15 * 60_000) },
    });
    if (i < 2) await world.ownerPrisma.complaintEvent.create({ data: { complaintId: created.id, eventType: "COMMENT", actorId: world.sanjay.id, payload: { kind: "ack" } } });
  }
  // Eight complaints that tie on every sort key (same creation time, same due time, same urgency), to prove that pages never repeat or skip a row.
  const template = await world.ownerPrisma.complaint.findFirstOrThrow({ where: { status: "ASSIGNED" } });
  const at = new Date(NOW - 3600_000);
  for (let i = 0; i < 8; i++) {
    await world.ownerPrisma.complaint.create({
      data: { flatId: template.flatId, raisedById: template.raisedById, body: `Tie ${i}: the tap leaks`, categoryId: template.categoryId, urgency: "HIGH", status: "NEW", assigneeId: null, responseDueAt: new Date(NOW + 3600_000), createdAt: at },
    });
  }
}, 240_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

type Fact = ViewFacts & RankFacts & { flatCode: string; categoryCode: string | null };
async function allFacts(): Promise<Fact[]> {
  const rows = await world.ownerPrisma.complaint.findMany({
    select: { id: true, status: true, safetyFlag: true, assigneeId: true, needsReview: true, responseDueAt: true, firstResponseAt: true, urgency: true, createdAt: true, closedAt: true, flat: { select: { code: true } }, category: { select: { code: true } } },
  });
  const acked = new Set((await world.ownerPrisma.complaintEvent.findMany({ where: { eventType: "COMMENT" }, select: { complaintId: true, payload: true } })).filter((e) => (e.payload as { kind?: string }).kind === "ack").map((e) => e.complaintId));
  return rows.map((r) => ({
    id: r.id, status: r.status, safetyFlag: r.safetyFlag, acknowledged: acked.has(r.id), assigneeId: r.assigneeId, needsReview: r.needsReview, urgency: r.urgency,
    responseDueAt: r.responseDueAt?.getTime() ?? null, firstResponseAt: r.firstResponseAt?.getTime() ?? null, createdAt: r.createdAt.getTime(), closedAt: r.closedAt?.getTime() ?? null,
    flatCode: r.flat.code, categoryCode: r.category?.code ?? null,
  }));
}

async function walk(user: Actor, view: BoardView, filters: BoardFilters = NO_FILTERS, limit = 15, maxPages = 1000): Promise<{ ids: string[]; pages: ViewBoard[] }> {
  const ids: string[] = [];
  const pages: ViewBoard[] = [];
  let cursor: string | undefined;
  do {
    const page = await listBoardView({ db: world.appPrisma, user, view, filters, cursor, limit, now: NOW });
    if (page.status !== "OK") throw new Error(page.error);
    pages.push(page);
    ids.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < maxPages);
  return { ids, pages };
}

/** The same rules, written again as plain SQL on the owner connection: another formulation, so a slip in either shows. */
const INDEPENDENT_SQL: Record<BoardView, (viewer: string) => string> = {
  needs_action: (v) => `status <> 'CLOSED' AND ((safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = complaints.id AND e.event_type = 'COMMENT' AND e.payload @> '{"kind":"ack"}'))
    OR assignee_id IS NULL OR (needs_review AND status = 'NEW') OR (assignee_id = '${v}' AND (status = 'REOPENED' OR (first_response_at IS NULL AND response_due_at < '${new Date(NOW).toISOString()}'))))`,
  mine: (v) => `status <> 'CLOSED' AND assignee_id = '${v}'`,
  safety: () => `status <> 'CLOSED' AND safety_flag`,
  triage: () => `status <> 'CLOSED' AND (assignee_id IS NULL OR (needs_review AND status = 'NEW'))`,
  open: () => `status IN ('ASSIGNED', 'IN_PROGRESS', 'REOPENED')`,
  overdue: () => `status <> 'CLOSED' AND first_response_at IS NULL AND response_due_at < '${new Date(NOW).toISOString()}'`,
  waiting: () => `status = 'PENDING_CONFIRMATION'`,
  closed: () => `status = 'CLOSED'`,
};
const sqlIds = async (view: BoardView, viewer: string): Promise<string[]> =>
  (await world.ownerPrisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM complaints WHERE ${INDEPENDENT_SQL[view](viewer)}`)).map((r) => r.id).sort();

describe("D151 each view against independent SQL on the seeded database", () => {
  it.each(BOARD_VIEWS.flatMap((view) => (["kavita", "sanjay"] as const).map((who) => [view, who] as const)))("%s for %s: the loader's rows, its count, the raw SQL and inView agree", async (view, who) => {
    const user = world[who];
    const { ids, pages } = await walk(user, view);
    const raw = await sqlIds(view, user.id);
    const facts = await allFacts();
    const pure = facts.filter((c) => inView(view, c, user.id, NOW)).map((c) => c.id).sort();
    expect([...ids].sort(), `${view} loader vs SQL`).toEqual(raw);
    expect(pure, `${view} inView vs SQL`).toEqual(raw);
    expect(pages[0].counts[view], `${view} count`).toBe(raw.length);
    expect(pages[0].total).toBe(ids.length);
    expect(new Set(ids).size).toBe(ids.length);
    console.log(`  ${view.padEnd(13)} ${who.padEnd(7)} loader ${String(pages[0].counts[view]).padStart(4)}  raw SQL ${String(raw.length).padStart(4)}`);
  }, 60_000);

  it("the counts of the seeded database are the ones the live evidence is about: triage is a small part of what it was", async () => {
    const page = await walk(world.kavita, "triage");
    const [{ old }] = await world.ownerPrisma.$queryRaw<{ old: number }[]>`SELECT count(*)::int AS old FROM complaints WHERE status <> 'CLOSED' AND (needs_review OR assignee_id IS NULL)`;
    expect(page.ids.length).toBeLessThan(old);
    console.log(`  triage now ${page.ids.length}, with the old rule ${old}`);
  });
});

describe("D151 ordering", () => {
  it.each(BOARD_VIEWS.filter((v) => v !== "closed"))("%s is sorted by band, due time, newest created, id; and nothing lower outranks an unacknowledged safety complaint", async (view) => {
    const { ids } = await walk(world.kavita, view);
    const byId = new Map((await allFacts()).map((c) => [c.id, c]));
    const ordered = ids.map((id) => byId.get(id)!);
    for (let i = 1; i < ordered.length; i++) expect(compareForView(view, ordered[i - 1], ordered[i]), `${view} at ${i}`).toBeLessThan(0);
    const firstOther = ordered.findIndex((c) => !(c.safetyFlag && !c.acknowledged && c.status !== "CLOSED"));
    if (firstOther >= 0) expect(ordered.slice(firstOther).some((c) => c.safetyFlag && !c.acknowledged && c.status !== "CLOSED")).toBe(false);
  }, 60_000);

  it("closed is newest closed first", async () => {
    const { ids } = await walk(world.kavita, "closed", NO_FILTERS, 50);
    const byId = new Map((await allFacts()).map((c) => [c.id, c]));
    const ordered = ids.map((id) => byId.get(id)!);
    for (let i = 1; i < ordered.length; i++) expect(compareForView("closed", ordered[i - 1], ordered[i])).toBeLessThan(0);
    expect(ordered.length).toBeGreaterThan(100);
  }, 120_000);

  it("in needs_action the unacknowledged safety complaints come first, then CRITICAL and HIGH, with the most overdue first", async () => {
    const page = await listBoardView({ db: world.appPrisma, user: world.sanjay, view: "needs_action", now: NOW });
    if (page.status !== "OK") throw new Error(page.error);
    const unackSafety = page.unacknowledgedSafety;
    expect(unackSafety).toBeGreaterThan(0);
    const firstRows = page.rows.slice(0, Math.min(unackSafety, page.rows.length));
    expect(firstRows.every((r) => r.safety && !r.acknowledged)).toBe(true);
  });
});

describe("D151 pagination across pages, ties included", () => {
  it("pages of 3 over every view equal pages of 15 and one page of 50, with no repeat and no skip", async () => {
    for (const view of ["safety", "triage", "overdue", "waiting"] as const) {
      const small = await walk(world.kavita, view, NO_FILTERS, 3);
      const large = await walk(world.kavita, view, NO_FILTERS, 50);
      expect(small.ids, view).toEqual(large.ids);
      expect(new Set(small.ids).size).toBe(small.ids.length);
      expect(small.pages.slice(0, -1).every((p) => p.rows.length === 3)).toBe(true);
      expect(small.pages.at(-1)?.nextCursor).toBeNull();
    }
  }, 120_000);

  it("the eight complaints that tie on every key stay in a stable order across page boundaries of 3", async () => {
    const small = await walk(world.kavita, "triage", NO_FILTERS, 3);
    const ties = await world.ownerPrisma.complaint.findMany({ where: { body: { startsWith: "Tie " } }, select: { id: true } });
    const positions = ties.map((t) => small.ids.indexOf(t.id)).sort((a, b) => a - b);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions.at(-1)! - positions[0]).toBe(7);
    const tieIds = small.ids.slice(positions[0], positions[0] + 8);
    expect(tieIds).toEqual([...tieIds].sort().reverse());
  }, 60_000);

  it("the first 90 rows of the needs_action view are the same in pages of 3 and pages of 15", async () => {
    const small = await walk(world.kavita, "needs_action", NO_FILTERS, 3, 30);
    const large = await walk(world.kavita, "needs_action", NO_FILTERS, 15, 6);
    expect(small.ids).toEqual(large.ids);
  }, 120_000);

  it("a cursor that is not ours, an unknown view, a limit outside 1 to 50 and a user without complaints:manage are refused", async () => {
    const base = { db: world.appPrisma, user: world.kavita, view: "open" as const, now: NOW };
    for (const cursor of ["x", "e30", Buffer.from('{"r":9,"d":"x","t":"y","id":"z"}').toString("base64url")]) expect(await listBoardView({ ...base, cursor })).toEqual({ status: "ERROR", error: "VALIDATION" });
    expect(await listBoardView({ ...base, view: "all" as BoardView })).toEqual({ status: "ERROR", error: "VALIDATION" });
    for (const limit of [0, 51, 1.5]) expect(await listBoardView({ ...base, limit })).toEqual({ status: "ERROR", error: "VALIDATION" });
    const priya = await world.ownerPrisma.user.findFirstOrThrow({ where: { name: "Priya Nair" }, select: { id: true, name: true, role: true, active: true, permissions: { select: { permission: true } } } });
    expect(await listBoardView({ ...base, user: { ...priya, permissions: priya.permissions.map((p) => p.permission) } })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
  });
});

describe("D151 filters", () => {
  const cases: [string, BoardFilters][] = [
    ["category", { ...NO_FILTERS, category: "LIFT" }],
    ["urgency", { ...NO_FILTERS, urgency: "HIGH" }],
    ["assignee unassigned", { ...NO_FILTERS, assignee: "unassigned" }],
    ["assignee me", { ...NO_FILTERS, assignee: "me" }],
    ["flat prefix tower", { ...NO_FILTERS, q: "T12" }],
    ["flat prefix tower and floor", { ...NO_FILTERS, q: "T07-12" }],
    ["all four", { category: "PLUMBING", assignee: "me", urgency: "NORMAL", q: "T0" + "1" }],
  ];

  it.each(cases)("%s: rows and counts equal the unfiltered rows filtered by hand, for every view", async (_name, filters) => {
    const facts = await allFacts();
    for (const view of BOARD_VIEWS) {
      const { ids, pages } = await walk(world.kavita, view, filters, 50);
      const expected = facts
        .filter((c) => inView(view, c, world.kavita.id, NOW))
        .filter((c) => filters.category === null || c.categoryCode === filters.category)
        .filter((c) => filters.urgency === null || c.urgency === filters.urgency)
        .filter((c) => filters.assignee === "anyone" || (filters.assignee === "me" ? c.assigneeId === world.kavita.id : c.assigneeId === null))
        .filter((c) => filters.q === null || c.flatCode.startsWith(filters.q))
        .map((c) => c.id)
        .sort();
      expect([...ids].sort(), `${view}`).toEqual(expected);
      expect(pages[0].counts[view]).toBe(expected.length);
    }
  }, 120_000);

  it("the filters change something (they are not ignored), and the unacknowledged-safety figure ignores them", async () => {
    const all = await listBoardView({ db: world.appPrisma, user: world.kavita, view: "open", now: NOW });
    const lifts = await listBoardView({ db: world.appPrisma, user: world.kavita, view: "open", filters: { ...NO_FILTERS, category: "LIFT" }, now: NOW });
    if (all.status !== "OK" || lifts.status !== "OK") throw new Error("read failed");
    expect(lifts.total).toBeLessThan(all.total);
    expect(lifts.total).toBeGreaterThan(0);
    expect(lifts.unacknowledgedSafety).toBe(all.unacknowledgedSafety);
  });

  it("a hostile address never reaches the SQL: the parser turns it into defaults, and the loader still answers", async () => {
    const query = parseBoardQuery({ view: "open'; DROP TABLE complaints;--", category: "LIFT' OR '1'='1", q: "T12%' OR 1=1--", assignee: "me; DELETE", urgency: "HIGH'" });
    expect(query).toEqual({ view: "needs_action", filters: NO_FILTERS });
    const page = await listBoardView({ db: world.appPrisma, user: world.kavita, view: query.view, filters: query.filters, now: NOW });
    expect(page.status).toBe("OK");
  });

  it("mine is the open complaints assigned to the viewer, and differs between two staff", async () => {
    const kavita = await walk(world.kavita, "mine", NO_FILTERS, 50);
    const sanjay = await walk(world.sanjay, "mine", NO_FILTERS, 50);
    const facts = await allFacts();
    expect([...kavita.ids].sort()).toEqual(facts.filter((c) => c.status !== "CLOSED" && c.assigneeId === world.kavita.id).map((c) => c.id).sort());
    expect(sanjay.ids.some((id) => kavita.ids.includes(id))).toBe(false);
  }, 60_000);
});

describe("D151 speed and the app role", () => {
  it("all the counts and one page take under 1.5 seconds, as the app role (which has no write access to the ledger of this read)", async () => {
    const { bestMs: elapsed, result: page } = await bestOfMsAsync(() => listBoardView({ db: world.appPrisma, user: world.kavita, view: "needs_action", now: NOW }));
    expect(page.status).toBe("OK");
    console.log(`  counts for 8 views and one page of 15 over ${await world.ownerPrisma.complaint.count()} complaints: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(1500);
  });

  it("the counts are one query: eight views, no query per view", async () => {
    const page = await listBoardView({ db: world.appPrisma, user: world.kavita, view: "open", now: NOW });
    if (page.status !== "OK") throw new Error(page.error);
    expect(Object.keys(page.counts)).toEqual([...BOARD_VIEWS]);
  });
});
