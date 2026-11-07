import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NullClassifier } from "@/server/complaints/classifier";
import { createComplaint } from "@/server/complaints/create";
import { loadComplaintDetail, loadComplaintList, loadRaiseFormData } from "@/server/complaints/page-data";
import { type World, DAY, NOW, arrange, makeResident, setupWorld } from "./complaints-helpers";

/** T13b: the loaders of the three complaint pages, through the APP role (the same grants as production), own flat only. */
let world: World;
beforeAll(async () => {
  world = await setupWorld();
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

type Resident = Awaited<ReturnType<typeof makeResident>>["user"];
const raise = async (user: Resident, body: string, declaredDanger = false) => {
  const result = await createComplaint({ db: world.appPrisma, user, body, now: NOW, classifier: NullClassifier, declaredDanger });
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint;
};
const list = (user: Resident, now = NOW) => loadComplaintList({ db: world.appPrisma, user, now });
const detail = (user: Resident, id: string, now = NOW) => loadComplaintDetail({ db: world.appPrisma, user, id, now });

describe("T13b /complaints loader", () => {
  it("shows only the complaints of the resident's own flat, open ones apart from closed ones", async () => {
    const mine = await makeResident(world);
    const other = await makeResident(world);
    const open = await raise(mine.user, "Water leak under the sink");
    const closed = await raise(mine.user, "Corridor light is out");
    await arrange(world, closed.id, { status: "CLOSED", closedAt: new Date(NOW), closeKind: "CONFIRMED" });
    await raise(other.user, "Lift button is stuck");
    const data = await list(mine.user);
    expect(data.kind).toBe("OK");
    if (data.kind !== "OK") return;
    expect(data.open.map((c) => c.id)).toEqual([open.id]);
    expect(data.closed.map((c) => c.id)).toEqual([closed.id]);
    expect(JSON.stringify(data)).not.toContain("Lift button");
  });

  it("a resident with no complaints gets empty lists, and one with no current flat gets NO_FLAT", async () => {
    const empty = await makeResident(world);
    expect(await list(empty.user)).toEqual({ kind: "OK", open: [], closed: [] });
    const lapsed = await makeResident(world);
    await world.ownerPrisma.flatMember.updateMany({ where: { userId: lapsed.user.id }, data: { endsOn: new Date("2026-02-01T00:00:00Z") } });
    expect(await list(lapsed.user)).toEqual({ kind: "NO_FLAT" });
  });

  it("D120 the list runs auto-close first: a complaint that waited 7 days shows as closed", async () => {
    const { user } = await makeResident(world);
    const complaint = await raise(user, "Water leak under the sink");
    await arrange(world, complaint.id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 8 * DAY) });
    const data = await list(user);
    expect(data.kind === "OK" && data.open).toEqual([]);
    expect(data.kind === "OK" && data.closed.map((c) => c.id)).toEqual([complaint.id]);
  });

  it("staff are refused (the page also guards by role)", async () => {
    await expect(list(world.staff.kavita)).rejects.toThrow("FORBIDDEN");
  });
});

describe("T13b /complaints/[id] loader", () => {
  it("returns the complaint of the resident's own flat with the auto-close days from the setting and the resident's timeline", async () => {
    const { user } = await makeResident(world);
    const complaint = await raise(user, "Water leak under the sink");
    const data = await detail(user, complaint.id);
    expect(data.kind).toBe("OK");
    if (data.kind !== "OK") return;
    expect(data.autoCloseDays).toBe(7);
    expect(data.complaint).toMatchObject({ id: complaint.id, title: "Water leak under the sink", safety: false, closeKind: null });
    expect(data.complaint.timeline.map((e) => e.kind)).toEqual(["RAISED", "ASSIGNED"]);
    await world.ownerPrisma.societySetting.update({ where: { key: "auto_close_days" }, data: { value: 3 } });
    const changed = await detail(user, complaint.id);
    await world.ownerPrisma.societySetting.update({ where: { key: "auto_close_days" }, data: { value: 7 } });
    expect(changed.kind === "OK" && changed.autoCloseDays).toBe(3);
  });

  it("a complaint of another flat, a missing one and an id that is not a UUID are all NOT_FOUND, and nothing of the complaint is returned", async () => {
    const mine = await makeResident(world);
    const other = await makeResident(world);
    const theirs = await raise(other.user, "Secret complaint text of the neighbour");
    for (const id of [theirs.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid", "../../etc"]) {
      const data = await detail(mine.user, id);
      expect(data, id).toEqual({ kind: "NOT_FOUND" });
    }
  });

  it("a closed safety complaint reports how it was closed and whether it may still be disputed", async () => {
    const { user } = await makeResident(world);
    const complaint = await raise(user, "fire in the basement");
    await arrange(world, complaint.id, { status: "CLOSED", closedAt: new Date(NOW - DAY), closeKind: "DUTY_MANAGER" });
    const data = await detail(user, complaint.id);
    expect(data.kind === "OK" && data.complaint).toMatchObject({ safety: true, status: "CLOSED", closeKind: "DUTY_MANAGER", canReopen: true });
    const late = await detail(user, complaint.id, NOW + 10 * DAY);
    expect(late.kind === "OK" && late.complaint.canReopen).toBe(false);
  });

  it("a resident with no current flat gets NO_FLAT", async () => {
    const lapsed = await makeResident(world);
    await world.ownerPrisma.flatMember.updateMany({ where: { userId: lapsed.user.id }, data: { endsOn: new Date("2026-02-01T00:00:00Z") } });
    expect(await detail(lapsed.user, "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "NO_FLAT" });
  });
});

describe("T13b /complaints/new loader", () => {
  it("reads the duty manager's number from the settings, null when it is not set or blank", async () => {
    expect(await loadRaiseFormData({ db: world.appPrisma })).toEqual({ dutyManagerPhone: null });
    await world.ownerPrisma.societySetting.create({ data: { key: "duty_manager_phone", value: " 5900000001 " } });
    expect(await loadRaiseFormData({ db: world.appPrisma })).toEqual({ dutyManagerPhone: "5900000001" });
    await world.ownerPrisma.societySetting.update({ where: { key: "duty_manager_phone" }, data: { value: "  " } });
    expect(await loadRaiseFormData({ db: world.appPrisma })).toEqual({ dutyManagerPhone: null });
  });
});
