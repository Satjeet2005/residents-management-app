import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createPrng } from "@/domain/seed/prng";
import { BOARD_VIEWS } from "@/domain/complaints/board-views";
import { NO_FILTERS } from "@/lib/staff-complaints/board-query";
import { listBoardView } from "@/server/complaints/board-views";
import { loadComplaintDetail } from "@/server/complaints/page-data";
import { loadComplaintPage } from "@/server/complaints/staff-page-data";
import { actorOf } from "./complaints-helpers";
import { scanSeedKeys } from "./seed-key-scan";
import { type SeededWorld, setupSeededWorld } from "./seeded-world";

const NOW = DEMO_NOW + 60_000;
let world: SeededWorld;
let owner: Client;
beforeAll(async () => {
  world = await setupSeededWorld();
  owner = new Client({ connectionString: world.ownerUrl });
  await owner.connect();
}, 240_000);
afterAll(async () => {
  await owner?.end();
  await world?.close();
});

type Row = { id: string; raised_by_id: string; status: string; safety_flag: boolean };

/** Runs a loader for each complaint and returns the ones that threw, with the error text (no personal data: complaint ids and the message only). */
async function failures(rows: Row[], load: (row: Row) => Promise<unknown>): Promise<{ id: string; error: string }[]> {
  const failed: { id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      await load(row);
    } catch (error) {
      failed.push({ id: row.id, error: String((error as Error).message).split("\n").map((l) => l.trim()).filter((l) => l !== "").slice(-1)[0]?.slice(0, 200) ?? "" });
    }
  }
  return failed;
}

describe("T13i every seeded complaint opens", () => {
  it("the staff detail page loads for every open complaint, every safety complaint and 300 seeded-random closed ones; the resident detail loads for the owner", async () => {
    const all = (await owner.query<Row>("SELECT id, raised_by_id, status, safety_flag FROM complaints ORDER BY id")).rows;
    const open = all.filter((r) => r.status !== "CLOSED");
    const safety = all.filter((r) => r.safety_flag);
    const closed = all.filter((r) => r.status === "CLOSED");
    const rng = createPrng(20261108);
    const sample = rng.shuffle(closed).slice(0, 300);
    const chosen = [...new Map([...open, ...safety, ...sample].map((r) => [r.id, r])).values()];
    expect(all.length).toBe(3450);
    expect(safety.length).toBe(31);
    expect(chosen.length).toBeGreaterThanOrEqual(open.length + 300);

    const staffFailed = await failures(chosen, async (r) => {
      const page = await loadComplaintPage({ db: world.appPrisma, user: world.sanjay, id: r.id, now: NOW });
      if (page === null) throw new Error("no page");
    });
    const owners = new Map<string, Awaited<ReturnType<typeof actorOf>>>();
    const residentFailed = await failures(chosen, async (r) => {
      if (!owners.has(r.raised_by_id)) owners.set(r.raised_by_id, await actorOf(world.ownerPrisma, r.raised_by_id));
      const detail = await loadComplaintDetail({ db: world.appPrisma, user: owners.get(r.raised_by_id)!, id: r.id, now: NOW });
      if (detail.kind === "NOT_FOUND") throw new Error("not found for the owner");
    });
    console.info(`T13i: processed ${chosen.length} (open ${open.length}, safety ${safety.length}, closed sample ${sample.length}); staff failures ${staffFailed.length}; resident failures ${residentFailed.length}`);
    expect(chosen.length).toBe(new Set([...open, ...safety, ...sample].map((r) => r.id)).size);
    expect(staffFailed).toEqual([]);
    expect(residentFailed).toEqual([]);
  }, 240_000);

  it("every board view pages through without throwing, and the safety view lists all open safety complaints", async () => {
    let seen = 0;
    for (const view of BOARD_VIEWS) {
      let cursor: string | undefined;
      let rows = 0;
      for (let page = 0; page < 200; page++) {
        const board = await listBoardView({ db: world.appPrisma, user: world.sanjay, view, filters: NO_FILTERS, cursor, limit: 50, now: NOW });
        if (board.status === "ERROR") throw new Error(`${view}: ${board.error}`);
        rows += board.rows.length;
        if (board.nextCursor === null) break;
        cursor = board.nextCursor;
      }
      const first = await listBoardView({ db: world.appPrisma, user: world.sanjay, view, filters: NO_FILTERS, now: NOW });
      if (first.status === "ERROR") throw new Error(first.error);
      expect(rows, view).toBe(first.counts[view]);
      seen += rows;
    }
    expect(seen).toBeGreaterThan(3000);
  }, 240_000);

  it("no text or jsonb column of any table holds a seed key (user:, flat:, complaint:, bill:, member:, staff:)", async () => {
    expect(await scanSeedKeys(owner)).toEqual([]);
  });

  it("a complaint whose events hold malformed ids still opens: a seed key, null, a number, a very long text, an empty text, an object, an unknown UUID, and an event with no actor", async () => {
    const model = (await owner.query<{ id: string }>("SELECT id FROM complaints WHERE status <> 'CLOSED' AND safety_flag ORDER BY id LIMIT 1")).rows[0];
    const bad: unknown[] = ["user:5000000005", null, 42, "x".repeat(5000), "", { nested: "user:5000000004" }, "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"];
    for (const [i, assignee] of bad.entries()) {
      await world.ownerPrisma.complaintEvent.create({ data: { complaintId: model.id, eventType: "ASSIGNED", actorId: null, payload: { assignee } as never, createdAt: new Date(NOW + i * 1000) } });
    }
    await world.ownerPrisma.complaintEvent.create({ data: { complaintId: model.id, eventType: "ESCALATED", actorId: null, payload: { reason: "SAFETY_RULE", to: "user:5000000005" }, createdAt: new Date(NOW + 9000) } });
    const page = await loadComplaintPage({ db: world.appPrisma, user: world.sanjay, id: model.id, now: NOW + 60_000 });
    expect(page).not.toBeNull();
    const assigned = page!.timeline.filter((l) => l.label.startsWith("Assigned to"));
    expect(assigned.filter((l) => l.label === "Assigned to someone").length).toBe(bad.length);
    const owner2 = await actorOf(world.ownerPrisma, (await owner.query<{ raised_by_id: string }>("SELECT raised_by_id FROM complaints WHERE id = $1", [model.id])).rows[0].raised_by_id);
    expect((await loadComplaintDetail({ db: world.appPrisma, user: owner2, id: model.id, now: NOW + 60_000 })).kind).toBe("OK");
    for (const view of BOARD_VIEWS) {
      const board = await listBoardView({ db: world.appPrisma, user: world.sanjay, view, now: NOW + 60_000 });
      expect(board.status, view).toBe("OK");
    }
  });
});
