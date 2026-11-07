import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ComplaintView } from "@/app/(staff)/staff/complaints/[id]/complaint-view";
import { BOARD_LANES } from "@/lib/staff-complaints/lanes";
import { NullClassifier } from "@/server/complaints/classifier";
import { createComplaint } from "@/server/complaints/create";
import { loadComplaintDetail } from "@/server/complaints/page-data";
import { acknowledgeSafety, closeSafety } from "@/server/complaints/safety";
import { addComment, setStatus } from "@/server/complaints/staff-actions";
import { loadBoardMore, loadBoardPage, loadComplaintPage, loadStaffLanding } from "@/server/complaints/staff-page-data";
import { StaffAccessError } from "@/server/statements/ui-data";
import { type World, DAY, NOW, arrange, makeResident, setupWorld } from "./complaints-helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

/** T13c: the loaders of the staff complaint pages, through the APP role (the same grants as production). */
let world: World;
let resident: Awaited<ReturnType<typeof makeResident>>;
const ids: Record<"open" | "triage" | "safety" | "waiting" | "closed" | "overdue", string> = { open: "", triage: "", safety: "", waiting: "", closed: "", overdue: "" };
const LOAD = NOW + 60_000;

const raise = async (user: Awaited<ReturnType<typeof makeResident>>["user"], body: string, now = NOW) => {
  const result = await createComplaint({ db: world.appPrisma, user, body, now, classifier: NullClassifier });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint;
};
const board = (user = world.staff.kavita, requested: Parameters<typeof loadBoardPage>[0]["requested"] = null, now = LOAD) => loadBoardPage({ db: world.appPrisma, user, requested, now });
const page = (id: string, user = world.staff.kavita) => loadComplaintPage({ db: world.appPrisma, user, id, now: LOAD });
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeAll(async () => {
  world = await setupWorld();
  resident = await makeResident(world);
  const other = async (body: string) => raise((await makeResident(world)).user, body);
  ids.open = (await other("Water leak under the sink")).id;
  ids.triage = (await other("Something odd happened near the garden gate")).id;
  ids.safety = (await other("gas smell in the corridor")).id;
  ids.waiting = (await other("Corridor light is out")).id;
  ids.closed = (await other("Lift button is stuck")).id;
  ids.overdue = (await other("Tap in the pantry is dripping")).id;
  await setStatus({ db: world.appPrisma, user: world.staff.kavita, id: ids.waiting, status: "PENDING_CONFIRMATION", note: "Bulb replaced", expectedVersion: 1, now: NOW });
  await arrange(world, ids.triage, { categoryId: null, assigneeId: null, needsReview: true, status: "NEW" });
  await arrange(world, ids.closed, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED" });
  await arrange(world, ids.overdue, { responseDueAt: new Date(NOW - 2 * 3_600_000), firstResponseAt: null });
}, 180_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

describe("SDATA1 the loaders run as the app role", () => {
  it("the client is the privilege-limited login, not the owner", async () => {
    const who = await world.appPrisma.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
    expect(who[0].user).toBe(world.role.name);
  });
});

describe("SDATA2 the lanes", () => {
  it("each lane holds the complaints the rules put in it, and the tabs carry the counts", async () => {
    const lanes = Object.fromEntries(await Promise.all(BOARD_LANES.map(async (lane) => [lane, await board(world.staff.kavita, lane)]))) as Record<(typeof BOARD_LANES)[number], Awaited<ReturnType<typeof board>>>;
    // A safety complaint has no category from the keyword fallback, so needs_review is true (A6 of docs/complaints-design.md) and it is in Needs triage too.
    expect(idsOf(lanes.NEEDS_TRIAGE.rows)).toEqual([ids.triage, ids.safety].sort());
    expect(idsOf(lanes.SAFETY.rows)).toEqual([ids.safety]);
    expect(idsOf(lanes.OPEN.rows)).toEqual([ids.open, ids.safety, ids.overdue].sort());
    expect(idsOf(lanes.OVERDUE.rows)).toEqual([ids.overdue]);
    expect(idsOf(lanes.WAITING_RESIDENT.rows)).toEqual([ids.waiting]);
    expect(idsOf(lanes.CLOSED.rows)).toEqual([ids.closed]);
    expect(lanes.OPEN.counts).toEqual({ NEEDS_TRIAGE: 2, SAFETY: 1, OPEN: 3, OVERDUE: 1, WAITING_RESIDENT: 1, CLOSED: 1 });
    expect(lanes.OPEN.now).toBe(LOAD);
  });

  it("a row says where its classification came from, whether it needs review, who has it and the reply clock", async () => {
    const triage = (await board(world.staff.kavita, "NEEDS_TRIAGE")).rows.find((r) => r.id === ids.triage);
    expect(triage).toMatchObject({ category: null, needsReview: true, assignee: null, status: "NEW", sla: "ON_TIME" });
    const safety = (await board(world.staff.kavita, "SAFETY")).rows[0];
    expect(safety).toMatchObject({ urgency: "CRITICAL", safety: true, source: "RULE", assignee: { name: "Sanjay Pawar" } });
    const overdue = (await board(world.staff.kavita, "OVERDUE")).rows[0];
    expect(overdue.sla).toBe("OVERDUE");
  });
});

describe("SDATA3 which lane opens first", () => {
  it("the duty manager lands on Safety while it has items; a plain manager on Needs triage", async () => {
    expect((await board(world.staff.sanjay)).lane).toBe("SAFETY");
    expect((await board(world.staff.kavita)).lane).toBe("NEEDS_TRIAGE");
  });

  it("a lane in the address wins for both", async () => {
    expect((await board(world.staff.sanjay, "CLOSED")).lane).toBe("CLOSED");
    expect((await board(world.staff.kavita, "SAFETY")).lane).toBe("SAFETY");
  });
});

describe("SDATA4 nobody without complaints:manage can load the pages", () => {
  const forbidden = async (run: () => Promise<unknown>) => {
    const error = await run().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(StaffAccessError);
  };

  it("a resident is refused by every loader at the data (the pages also send them away)", async () => {
    await forbidden(() => board(resident.user));
    await forbidden(() => loadBoardMore({ db: world.appPrisma, user: resident.user, lane: "OPEN", cursor: "x", now: LOAD }));
    await forbidden(() => page(ids.open, resident.user));
  });

  it("staff without complaints:manage are refused too", async () => {
    await forbidden(() => board(world.staff.priya));
    await forbidden(() => page(ids.open, world.staff.priya));
  });

  it("the landing count is zero for both, never the real number", async () => {
    expect(await loadStaffLanding({ db: world.appPrisma, user: resident.user })).toEqual({ openSafety: 0 });
    expect(await loadStaffLanding({ db: world.appPrisma, user: world.staff.priya })).toEqual({ openSafety: 0 });
  });
});

describe("SDATA5 the staff landing count", () => {
  it("counts the open safety complaints for a manager, and not a closed one", async () => {
    expect(await loadStaffLanding({ db: world.appPrisma, user: world.staff.kavita })).toEqual({ openSafety: 1 });
  });
});

describe("SDATA6 the complaint page loader", () => {
  it("returns the full timeline with internal events and comments, marked, and the names of the people", async () => {
    await addComment({ db: world.appPrisma, user: world.staff.kavita, id: ids.open, text: "Plumber booked for Monday", visibleToResident: false, now: NOW + 1000 });
    await addComment({ db: world.appPrisma, user: world.staff.kavita, id: ids.open, text: "The plumber visits on Monday", visibleToResident: true, now: NOW + 2000 });
    const loaded = await page(ids.open);
    expect(loaded).not.toBeNull();
    const lines = loaded?.timeline ?? [];
    expect(lines.map((l) => `${l.visibility}: ${l.label}`)).toEqual([
      "visible: Raised",
      "internal: Classified by Keywords",
      "visible: Assigned to Kavita Rao",
      "internal: Comment, internal",
      "visible: Comment, visible to the resident",
    ]);
    expect(lines.find((l) => l.label === "Comment, internal")?.text).toBe("Plumber booked for Monday");
    expect(loaded?.complaint).toMatchObject({ flatCode: expect.any(String), raisedBy: expect.any(String), status: "ASSIGNED" });
    expect(loaded?.classifications[0]).toMatchObject({ source: "FALLBACK" });
  });

  it("an internal comment is on the staff page and NOT on the resident's page; a visible one is on both", async () => {
    const own = (await world.ownerPrisma.complaint.findUniqueOrThrow({ where: { id: ids.open }, select: { raisedById: true } })).raisedById;
    const user = (await world.ownerPrisma.user.findUniqueOrThrow({ where: { id: own }, select: { id: true, name: true, role: true, active: true } }));
    const data = await loadComplaintDetail({ db: world.appPrisma, user: { ...user, permissions: [] }, id: ids.open, now: LOAD });
    expect(data.kind).toBe("OK");
    const seen = JSON.stringify(data);
    expect(seen).toContain("The plumber visits on Monday");
    expect(seen).not.toContain("Plumber booked for Monday");
  });

  it("lists the people who may be assigned: active staff with complaints:manage, not accounts-only staff", async () => {
    const loaded = await page(ids.open);
    expect(loaded?.staffUsers.map((u) => u.name)).toEqual(["Kavita Rao", "Sanjay Pawar"]);
  });

  it("says who is looking: the duty manager flag is set for Sanjay Pawar only", async () => {
    expect((await page(ids.safety, world.staff.sanjay))?.viewer).toEqual({ canManage: true, isDutyManager: true });
    expect((await page(ids.safety, world.staff.kavita))?.viewer).toEqual({ canManage: true, isDutyManager: false });
  });

  it("a missing complaint and a bad id are both null", async () => {
    expect(await page("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await page("not-an-id")).toBeNull();
  });
});

describe("SDATA7 the duty manager's controls, from the real data", () => {
  const render = async (id: string, user: typeof world.staff.sanjay) => {
    const loaded = await page(id, user);
    if (loaded === null) throw new Error("missing");
    return renderToStaticMarkup(h(ComplaintView, { page: loaded }));
  };

  it("before the acknowledgement the duty manager sees both controls, the first filled; a plain manager sees neither", async () => {
    const duty = await render(ids.safety, world.staff.sanjay);
    expect(duty).toMatch(/<button[^>]*bg-accent[^>]*>I have seen this<\/button>/);
    expect(duty).toContain(">Close this safety complaint</button>");
    expect(duty).not.toContain("Mark resolved");
    const manager = await render(ids.safety, world.staff.kavita);
    expect(manager).not.toContain("I have seen this");
    expect(manager).not.toContain("Close this safety complaint");
    expect(manager).not.toContain("Mark resolved");
    expect(manager).toContain("The duty manager has not seen this yet.");
  });

  it("an ordinary complaint never shows them, to the duty manager either", async () => {
    const out = await render(ids.open, world.staff.sanjay);
    expect(out).not.toContain("I have seen this");
    expect(out).not.toContain("Close this safety complaint");
  });

  it("after the acknowledgement the first control is gone, the page says when, and nothing is filled", async () => {
    const ack = await acknowledgeSafety({ db: world.appPrisma, user: world.staff.sanjay, id: ids.safety, now: NOW + 5 * 60_000 });
    expect(ack.status).toBe("OK");
    const out = await render(ids.safety, world.staff.sanjay);
    expect(out).not.toContain("I have seen this");
    expect(out).not.toContain("bg-accent");
    expect(out).toContain(">Close this safety complaint</button>");
    expect(out).toContain("The duty manager saw this at");
    const loaded = await page(ids.safety, world.staff.sanjay);
    expect(loaded?.acknowledgedAt).toBe(NOW + 5 * 60_000);
    expect(loaded?.timeline.some((l) => l.label === "Seen by the duty manager" && l.visibility === "internal")).toBe(true);
  });
});

describe("SDATA8 paging and lazy auto-close", () => {
  it("Load more returns the rest of a long lane, newest first, with no repeat", async () => {
    const WORDS = ["alder", "birch", "cedar", "dogwood", "elm", "fir", "ginkgo", "hazel", "iroko", "juniper", "kauri", "larch", "maple", "neem", "oak", "palm", "quince", "rowan", "sal", "teak", "ulmo", "vine", "willow", "yew", "zelkova", "acacia", "banyan"];
    const user = (await makeResident(world)).user;
    for (const [index, word] of WORDS.entries()) await raise(user, `Water leak near the ${word} tree`, NOW - (index + 1) * 60_000);
    const first = await board(world.staff.kavita, "OPEN");
    expect(first.rows).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    const second = await loadBoardMore({ db: world.appPrisma, user: world.staff.kavita, lane: "OPEN", cursor: first.nextCursor ?? "", now: LOAD });
    expect(second.nextCursor).toBeNull();
    const all = [...first.rows, ...second.rows];
    expect(all).toHaveLength(first.counts.OPEN);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    const ages = all.map((r) => r.ageMinutes);
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
  });

  it("D120 loading the board closes a resolved complaint the resident never answered", async () => {
    const user = (await makeResident(world)).user;
    const stale = await raise(user, "Garbage was not collected from our floor");
    await arrange(world, stale.id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 8 * DAY) });
    const closed = await board(world.staff.kavita, "CLOSED");
    expect(closed.rows.map((r) => r.id)).toContain(stale.id);
    expect((await page(stale.id))?.complaint.closeKind).toBe("AUTO_CLOSED");
  });

  it("closing the safety complaint empties the Safety lane, so the duty manager lands on Needs triage again", async () => {
    const closed = await closeSafety({ db: world.appPrisma, user: world.staff.sanjay, id: ids.safety, note: "Gas isolated and checked", now: NOW + 10 * 60_000 });
    expect(closed.status).toBe("OK");
    expect((await board(world.staff.sanjay)).lane).toBe("NEEDS_TRIAGE");
    expect(await loadStaffLanding({ db: world.appPrisma, user: world.staff.sanjay })).toEqual({ openSafety: 0 });
  });
});
