import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSettings } from "@/domain/seed/settings";
import { NullClassifier } from "@/server/complaints/classifier";
import { createComplaint } from "@/server/complaints/create";
import { acknowledgeSafety } from "@/server/complaints/safety";
import { addComment, assign, setStatus } from "@/server/complaints/staff-actions";
import { getHomeData } from "@/server/home/home-data";
import { type World, NOW, loadComplaint, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
beforeAll(async () => {
  world = await setupWorld();
  for (const { key, value } of buildSettings().filter((s) => ["late_fee_policy", "safety_ack_timeout_minutes", "duty_manager_phone", "emergency_services_phone"].includes(s.key))) {
    await world.ownerPrisma.societySetting.create({ data: { key, value: value as never } });
  }
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const MIN = 60_000;
type Resident = Awaited<ReturnType<typeof makeResident>>["user"];

const raiseDanger = async () => {
  const { user } = await makeResident(world);
  const result = await createComplaint({ db: world.appPrisma, user, body: "The garden bench needs paint", now: NOW, classifier: NullClassifier, declaredDanger: true });
  if (result.status !== "OK") throw new Error(result.error);
  return { user, id: result.complaint.id };
};
const alertOf = async (user: Resident, now: number) => {
  const data = await getHomeData({ db: world.appPrisma, user, now });
  if (data.kind !== "OK") throw new Error(data.kind);
  return data.safetyAlert;
};
const versionOf = async (id: string) => (await loadComplaint(world, id)).version;

describe("D54 / D126 a safety alert is acknowledged only by the duty manager's own action", () => {
  it("AK1 a plain manager's comment is a first reply for the SLA but the alert stays 1a, then 1c", async () => {
    const { user, id } = await raiseDanger();
    const comment = await addComment({ db: world.appPrisma, user: world.staff.kavita, id, text: "Looking into it", visibleToResident: true, now: NOW + MIN });
    expect(comment.status).toBe("OK");
    expect((await loadComplaint(world, id)).firstResponseAt?.getTime()).toBe(NOW + MIN);
    expect((await alertOf(user, NOW + 2 * MIN))?.state).toBe("SENT");
    expect(await alertOf(user, NOW + 5 * MIN)).toMatchObject({ state: "NO_ANSWER", seenAt: null });
  });

  it("AK2 a plain manager's assign never turns the alert into 1b", async () => {
    const { user, id } = await raiseDanger();
    const done = await assign({ db: world.appPrisma, user: world.staff.kavita, id, assigneeUserId: world.staff.kavita.id, expectedVersion: await versionOf(id), now: NOW + MIN });
    expect(done.status).toBe("OK");
    expect((await loadComplaint(world, id)).firstResponseAt).not.toBeNull();
    expect((await alertOf(user, NOW + 2 * MIN))?.state).toBe("SENT");
    expect((await alertOf(user, NOW + 5 * MIN))?.state).toBe("NO_ANSWER");
  });

  it("AK3 a plain manager's status change never turns the alert into 1b", async () => {
    const { user, id } = await raiseDanger();
    const done = await setStatus({ db: world.appPrisma, user: world.staff.kavita, id, status: "IN_PROGRESS", expectedVersion: await versionOf(id), now: NOW + MIN });
    expect(done.status).toBe("OK");
    expect((await loadComplaint(world, id)).firstResponseAt).not.toBeNull();
    expect((await alertOf(user, NOW + 2 * MIN))?.state).toBe("SENT");
    expect((await alertOf(user, NOW + 5 * MIN))?.state).toBe("NO_ANSWER");
  });

  it("AK4 the duty manager's acknowledgeSafety is what produces 1b, with its own time, even after a manager replied earlier", async () => {
    const { user, id } = await raiseDanger();
    await addComment({ db: world.appPrisma, user: world.staff.kavita, id, text: "Looking into it", visibleToResident: true, now: NOW + MIN });
    expect((await acknowledgeSafety({ db: world.appPrisma, user: world.staff.kavita, id, now: NOW + 2 * MIN })).status === "ERROR" && "FORBIDDEN").toBe("FORBIDDEN");
    expect((await alertOf(user, NOW + 3 * MIN))?.state).toBe("SENT");
    expect((await acknowledgeSafety({ db: world.appPrisma, user: world.staff.sanjay, id, now: NOW + 4 * MIN })).status).toBe("OK");
    expect(await alertOf(user, NOW + 6 * MIN)).toMatchObject({ state: "SEEN", seenAt: NOW + 4 * MIN });
  });
});
