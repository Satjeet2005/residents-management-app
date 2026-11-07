import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSettings } from "@/domain/seed/settings";
import { NullClassifier } from "@/server/complaints/classifier";
import { createComplaint } from "@/server/complaints/create";
import { acknowledgeSafety } from "@/server/complaints/safety";
import type { Db } from "@/server/auth/db";
import { getHomeData } from "@/server/home/home-data";
import { type World, DAY, NOW, arrange, makeResident, setupWorld } from "./complaints-helpers";

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
const home = async (user: Awaited<ReturnType<typeof makeResident>>["user"], now: number, db: Db = world.appPrisma) => {
  const data = await getHomeData({ db, user, now });
  if (data.kind !== "OK") throw new Error(`expected OK, got ${data.kind}`);
  return data;
};
const raise = (user: Awaited<ReturnType<typeof makeResident>>["user"], body: string, declaredDanger = false) => createComplaint({ db: world.appPrisma, user, body, now: NOW, classifier: NullClassifier, declaredDanger });
const raised = async (user: Awaited<ReturnType<typeof makeResident>>["user"], body: string, declaredDanger = false) => {
  const result = await raise(user, body, declaredDanger);
  if (result.status !== "OK") throw new Error(result.error);
  return result.complaint;
};

describe("D126 the Home loader under the app role: the safety alert", () => {
  it("D126 a declared danger with innocuous text gives alert 1a at once, with the duty manager's number and no category", async () => {
    const { user } = await makeResident(world);
    await raised(user, "The garden bench needs paint", true);
    const alert = (await home(user, NOW + MIN)).safetyAlert;
    expect(alert).toEqual({ state: "SENT", category: null, seenAt: null, callPhone: "5900000001" });
  });

  it("D126 a safety word gives the category; the duty manager's acknowledge action turns it into 1b with the time (D54)", async () => {
    const { user } = await makeResident(world);
    const complaint = await raised(user, "There is a fire in the basement");
    expect((await home(user, NOW + MIN)).safetyAlert).toMatchObject({ state: "SENT", category: "FIRE" });
    const ack = await acknowledgeSafety({ db: world.appPrisma, user: world.staff.sanjay, id: complaint.id, now: NOW + 2 * MIN });
    expect(ack.status).toBe("OK");
    expect((await home(user, NOW + 3 * MIN)).safetyAlert).toEqual({ state: "SEEN", category: "FIRE", seenAt: NOW + 2 * MIN, callPhone: "5900000001" });
  });

  it("D126 with no acknowledgement after safety_ack_timeout_minutes the alert is 1c", async () => {
    const { user } = await makeResident(world);
    await raised(user, "gas leak in the kitchen");
    expect((await home(user, NOW + 4 * MIN)).safetyAlert?.state).toBe("SENT");
    expect((await home(user, NOW + 5 * MIN)).safetyAlert).toMatchObject({ state: "NO_ANSWER", callPhone: "5900000001" });
    await world.ownerPrisma.societySetting.update({ where: { key: "emergency_services_phone" }, data: { value: "112" } });
    expect((await home(user, NOW + 5 * MIN)).safetyAlert).toMatchObject({ state: "NO_ANSWER", callPhone: "112" });
    await world.ownerPrisma.societySetting.update({ where: { key: "emergency_services_phone" }, data: { value: null as never } });
  });

  it("D126 a resident of another flat never sees the alert, and an ordinary complaint raises none", async () => {
    const mine = await makeResident(world);
    const other = await makeResident(world);
    await raised(mine.user, "There is a fire in the basement");
    expect((await home(other.user, NOW + MIN)).safetyAlert).toBeNull();
    const plain = await makeResident(world);
    await raised(plain.user, "Water leak under the sink");
    expect((await home(plain.user, NOW + MIN)).safetyAlert).toBeNull();
  });

  it("D126 the alert goes away once the duty manager has closed the complaint", async () => {
    const { user } = await makeResident(world);
    const complaint = await raised(user, "shock from the switch");
    await arrange(world, complaint.id, { status: "CLOSED", closedAt: new Date(NOW + MIN), closeKind: "DUTY_MANAGER" });
    expect((await home(user, NOW + 2 * MIN)).safetyAlert).toBeNull();
  });

  it("D126 the Home complaint card carries the complaint id for its link", async () => {
    const { user } = await makeResident(world);
    const complaint = await raised(user, "Water leak under the sink");
    expect((await home(user, NOW + MIN)).complaint?.id).toBe(complaint.id);
  });
});

describe("D120 the Home loads auto-close lazily", () => {
  it("D120 a complaint that waited auto_close_days is closed when the Home loads, and the Home shows no open complaint", async () => {
    const { user } = await makeResident(world);
    const complaint = await raised(user, "Water leak under the sink");
    await arrange(world, complaint.id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - 8 * DAY) });
    const data = await home(user, NOW);
    expect(data.complaint).toBeNull();
    expect(await world.ownerPrisma.complaint.findUniqueOrThrow({ where: { id: complaint.id }, select: { status: true, closeKind: true } })).toEqual({ status: "CLOSED", closeKind: "AUTO_CLOSED" });
  });

  it("D120 a safety complaint is never auto-closed by the Home, however long it waits", async () => {
    const { user } = await makeResident(world);
    const complaint = await raised(user, "fire in the basement");
    const data = await home(user, NOW + 30 * DAY);
    expect(data.safetyAlert?.state).toBe("NO_ANSWER");
    expect((await world.ownerPrisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } })).status).toBe("ASSIGNED");
  });

  it("D120 a failure of auto-close is logged without data and the Home still loads", async () => {
    const { user } = await makeResident(world);
    await raised(user, "Water leak under the sink");
    const failing = new Proxy(world.appPrisma, {
      get(target, prop, receiver) {
        if (prop === "complaint") {
          const real = target.complaint;
          const findMany = (args: { where?: { status?: unknown } }) => (args.where?.status === "PENDING_CONFIRMATION" ? Promise.reject(new Error("boom: secret detail")) : real.findMany(args as never));
          return new Proxy(real, { get: (inner, name, innerReceiver) => (name === "findMany" ? findMany : Reflect.get(inner, name, innerReceiver)) });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as Db;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const data = await home(user, NOW, failing);
      expect(data.complaint?.title).toBe("Water leak under the sink");
      expect(logged).toHaveBeenCalledWith("auto-close failed");
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret detail");
    } finally {
      logged.mockRestore();
    }
  });
});
