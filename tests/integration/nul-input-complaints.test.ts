import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGuards, type Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { handleBoard, handleClose, handleComment, handleCreate, handleReopen, handleSetStatus } from "@/server/complaints/handlers";
import { type World, NOW, makeResident, setupWorld } from "./complaints-helpers";

/**
 * A-001 for the complaint routes: a NUL (U+0000) in the comment text, a status note, a close note, a reopen reason or the board's `q` answers the
 * route's validation answer (422 VALIDATION), stores nothing, and the same request without it is read normally. A complaint's own text keeps its existing handling.
 */
let world: World;
let residentCookie: string;
let kavitaCookie: string;
let sanjayCookie: string;
let complaintId: string;
beforeAll(async () => {
  world = await setupWorld();
  const mine = await makeResident(world);
  residentCookie = await world.signIn(mine.user.id, "RESIDENT", NOW);
  kavitaCookie = await world.signIn(world.staff.kavita.id, "STAFF", NOW);
  sanjayCookie = await world.signIn(world.staff.sanjay.id, "STAFF", NOW);
  const created = await call("RESIDENT", (c) => handleCreate(c, { now: NOW }), "POST", "/api/complaints", residentCookie, { body: "Water leak under the sink" });
  complaintId = ((await created.json()) as { complaint: { id: string } }).complaint.id;
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const guards = () => createGuards(() => ({ db: world.appPrisma, sender: mockOtpSender, now: () => NOW }));
type Handler = (context: Parameters<Parameters<ReturnType<typeof guards>["withPermission"]>[1]>[0]) => Promise<Response>;
async function call(need: Need, handler: Handler, method: "GET" | "POST", path: string, cookie: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { host: "localhost", cookie };
  const init: RequestInit = { method, headers: body === undefined ? headers : { ...headers, "content-type": "application/json", origin: "http://localhost" }, body: body === undefined ? undefined : JSON.stringify(body) };
  return guards().withPermission(need, handler)(new Request(`http://localhost${path}`, init));
}
const NUL = "\u0000";
/** The complaint routes have their own documented validation answer: 422 VALIDATION (the statement routes answer 400 INVALID_REQUEST). */
const invalid = async (response: Response) => {
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "VALIDATION" });
};
const eventCount = () => world.ownerPrisma.complaintEvent.count({ where: { complaintId } });

describe("A-001 the complaint routes", () => {
  it("staff comment: a NUL in the text is refused (422) and no event is stored; without it the comment is stored (200)", async () => {
    const before = await eventCount();
    await invalid(await call("complaints:manage", (c) => handleComment(c, { now: NOW }), "POST", `/api/staff/complaints/${complaintId}/comment`, kavitaCookie, { text: `Plumber${NUL} is coming`, visibleToResident: true }));
    expect(await eventCount()).toBe(before);
    const ok = await call("complaints:manage", (c) => handleComment(c, { now: NOW }), "POST", `/api/staff/complaints/${complaintId}/comment`, kavitaCookie, { text: "Plumber is coming", visibleToResident: true });
    expect(ok.status).toBe(200);
    expect(await eventCount()).toBe(before + 1);
  });

  it("status note and close note: a NUL is refused (422) and nothing is stored", async () => {
    const before = await eventCount();
    await invalid(await call("complaints:manage", (c) => handleSetStatus(c, { now: NOW }), "POST", `/api/staff/complaints/${complaintId}/status`, kavitaCookie, { status: "IN_PROGRESS", note: `started${NUL}`, expectedVersion: 1 }));
    await invalid(await call("complaints:duty_manager", (c) => handleClose(c, { now: NOW }), "POST", `/api/staff/complaints/${complaintId}/close`, sanjayCookie, { note: `done${NUL}` }));
    expect(await eventCount()).toBe(before);
  });

  it("reopen: a NUL in the reason is refused (422); the same request without it is read (not a 400)", async () => {
    await invalid(await call("RESIDENT", (c) => handleReopen(c, { now: NOW }), "POST", `/api/complaints/${complaintId}/reopen`, residentCookie, { reason: `still leaking${NUL}` }));
    const ok = await call("RESIDENT", (c) => handleReopen(c, { now: NOW }), "POST", `/api/complaints/${complaintId}/reopen`, residentCookie, { reason: "still leaking" });
    expect(ok.status).not.toBe(400);
    expect(ok.status).not.toBe(500);
  });

  it("board filter q: a NUL is refused (422); an ordinary flat prefix answers 200", async () => {
    await invalid(await call("complaints:manage", (c) => handleBoard(c, { now: NOW }), "GET", `/api/staff/complaints?q=${encodeURIComponent(`T12${NUL}`)}`, kavitaCookie));
    expect((await call("complaints:manage", (c) => handleBoard(c, { now: NOW }), "GET", "/api/staff/complaints?q=T12", kavitaCookie)).status).toBe(200);
  });

  it("a complaint's own text with a NUL keeps its existing handling (201): this change does not touch it", async () => {
    const response = await call("RESIDENT", (c) => handleCreate(c, { now: NOW }), "POST", "/api/complaints", residentCookie, { body: `Lift${NUL} not working on floor 4` });
    expect(response.status).toBe(201);
  });
});
