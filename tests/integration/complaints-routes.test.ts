import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGuards, type Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { handleAcknowledge, handleAssign, handleBoard, handleCategory, handleClose, handleComment, handleConfirm, handleCreate, handleGetOwn, handleListOwn, handleReopen, handleSetStatus, handleStaffGet, handleStaffUsers } from "@/server/complaints/handlers";
import { type World, DAY, NOW, arrange, makeResident, setupWorld } from "./complaints-helpers";

let world: World;
let residentCookie: string;
let otherResidentCookie: string;
let kavitaCookie: string;
let sanjayCookie: string;
let priyaCookie: string;
beforeAll(async () => {
  world = await setupWorld();
  const mine = await makeResident(world);
  const other = await makeResident(world);
  residentCookie = await world.signIn(mine.user.id, "RESIDENT", NOW);
  otherResidentCookie = await world.signIn(other.user.id, "RESIDENT", NOW);
  kavitaCookie = await world.signIn(world.staff.kavita.id, "STAFF", NOW);
  sanjayCookie = await world.signIn(world.staff.sanjay.id, "STAFF", NOW);
  priyaCookie = await world.signIn(world.staff.priya.id, "STAFF", NOW);
}, 120_000);
afterAll(async () => {
  await world?.close();
}, 60_000);

const guards = () => createGuards(() => ({ db: world.appPrisma, sender: mockOtpSender, now: () => NOW }));
type Handler = (context: Parameters<Parameters<ReturnType<typeof guards>["withPermission"]>[1]>[0]) => Promise<Response>;
const ZERO = "00000000-0000-4000-8000-000000000000";

/** The same wrapper and permission as the route file (the static test below proves each file says so). */
async function call(need: Need, handler: Handler, method: "GET" | "POST", path: string, cookie: string | null, body?: unknown, rawBody?: string): Promise<Response> {
  const route = guards().withPermission(need, handler);
  const headers: Record<string, string> = { host: "localhost", ...(cookie === null ? {} : { cookie }) };
  const hasBody = body !== undefined || rawBody !== undefined;
  const init: RequestInit = { method, headers: hasBody ? { ...headers, "content-type": "application/json", origin: "http://localhost" } : headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) };
  return route(new Request(`http://localhost${path}`, init));
}
const opts = { now: NOW };
const create = (cookie: string | null, body: unknown, raw?: string) => call("RESIDENT", (c) => handleCreate(c, opts), "POST", "/api/complaints", cookie, body, raw);
const listOwn = (cookie: string | null) => call("RESIDENT", (c) => handleListOwn(c, opts), "GET", "/api/complaints", cookie);
const getOwn = (id: string, cookie: string | null) => call("RESIDENT", (c) => handleGetOwn(c, opts), "GET", `/api/complaints/${id}`, cookie);
const confirm = (id: string, cookie: string | null, body: unknown = {}) => call("RESIDENT", (c) => handleConfirm(c, opts), "POST", `/api/complaints/${id}/confirm`, cookie, body);
const reopen = (id: string, cookie: string | null, body: unknown) => call("RESIDENT", (c) => handleReopen(c, opts), "POST", `/api/complaints/${id}/reopen`, cookie, body);
const board = (query: string, cookie: string | null) => call("complaints:manage", (c) => handleBoard(c, opts), "GET", `/api/staff/complaints${query}`, cookie);
const staffGet = (id: string, cookie: string | null) => call("complaints:manage", handleStaffGet, "GET", `/api/staff/complaints/${id}`, cookie);
const staffUsers = (cookie: string | null) => call("complaints:manage", handleStaffUsers, "GET", "/api/staff/users", cookie);
const assignTo = (id: string, cookie: string | null, body: unknown) => call("complaints:manage", (c) => handleAssign(c, opts), "POST", `/api/staff/complaints/${id}/assign`, cookie, body);
const status = (id: string, cookie: string | null, body: unknown) => call("complaints:manage", (c) => handleSetStatus(c, opts), "POST", `/api/staff/complaints/${id}/status`, cookie, body);
const comment = (id: string, cookie: string | null, body: unknown) => call("complaints:manage", (c) => handleComment(c, opts), "POST", `/api/staff/complaints/${id}/comment`, cookie, body);
const category = (id: string, cookie: string | null, body: unknown) => call("complaints:manage", (c) => handleCategory(c, opts), "POST", `/api/staff/complaints/${id}/category`, cookie, body);
const acknowledge = (id: string, cookie: string | null, body: unknown = {}) => call("complaints:duty_manager", (c) => handleAcknowledge(c, opts), "POST", `/api/staff/complaints/${id}/acknowledge`, cookie, body);
const close = (id: string, cookie: string | null, body: unknown) => call("complaints:duty_manager", (c) => handleClose(c, opts), "POST", `/api/staff/complaints/${id}/close`, cookie, body);

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe("CL3 the route files use the wrapper and the permission of the task", () => {
  const EXPECTED: Record<string, Record<string, string>> = {
    "complaints/route.ts": { POST: "RESIDENT", GET: "RESIDENT" },
    "complaints/[id]/route.ts": { GET: "RESIDENT" },
    "complaints/[id]/confirm/route.ts": { POST: "RESIDENT" },
    "complaints/[id]/reopen/route.ts": { POST: "RESIDENT" },
    "staff/complaints/route.ts": { GET: "complaints:manage" },
    "staff/complaints/[id]/route.ts": { GET: "complaints:manage" },
    "staff/complaints/[id]/assign/route.ts": { POST: "complaints:manage" },
    "staff/complaints/[id]/status/route.ts": { POST: "complaints:manage" },
    "staff/complaints/[id]/comment/route.ts": { POST: "complaints:manage" },
    "staff/complaints/[id]/category/route.ts": { POST: "complaints:manage" },
    "staff/complaints/[id]/acknowledge/route.ts": { POST: "complaints:duty_manager" },
    "staff/complaints/[id]/close/route.ts": { POST: "complaints:duty_manager" },
    "staff/users/route.ts": { GET: "complaints:manage" },
  };
  it.each(Object.entries(EXPECTED))("CL3 %s", (file, methods) => {
    const source = readFileSync(path.resolve(process.cwd(), "src/app/api", file), "utf8");
    const found = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = withPermission\("([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(found)).toEqual(methods);
  });
});

describe("CL3 who may call what", () => {
  it("CL3 no session is 401 on every complaint route", async () => {
    const attempts: (() => Promise<Response>)[] = [
      () => create(null, { body: "x" }), () => listOwn(null), () => getOwn(ZERO, null), () => confirm(ZERO, null), () => reopen(ZERO, null, { reason: "abcde" }),
      () => board("", null), () => staffGet(ZERO, null), () => staffUsers(null), () => assignTo(ZERO, null, {}), () => status(ZERO, null, {}), () => comment(ZERO, null, {}), () => category(ZERO, null, {}), () => acknowledge(ZERO, null), () => close(ZERO, null, {}),
    ];
    for (const [i, attempt] of attempts.entries()) expect((await attempt()).status, `route ${i}`).toBe(401);
  });

  it("CL3 a resident is 403 on every staff route; staff are 403 on every resident route", async () => {
    const asResident: (() => Promise<Response>)[] = [() => board("", residentCookie), () => staffGet(ZERO, residentCookie), () => staffUsers(residentCookie), () => assignTo(ZERO, residentCookie, {}), () => status(ZERO, residentCookie, {}), () => comment(ZERO, residentCookie, {}), () => category(ZERO, residentCookie, {}), () => acknowledge(ZERO, residentCookie), () => close(ZERO, residentCookie, {})];
    for (const [i, attempt] of asResident.entries()) expect((await attempt()).status, `resident route ${i}`).toBe(403);
    const asStaff: (() => Promise<Response>)[] = [() => create(kavitaCookie, { body: "x" }), () => listOwn(kavitaCookie), () => getOwn(ZERO, kavitaCookie), () => confirm(ZERO, kavitaCookie), () => reopen(ZERO, kavitaCookie, { reason: "abcde" })];
    for (const [i, attempt] of asStaff.entries()) expect((await attempt()).status, `staff route ${i}`).toBe(403);
    expect(await json(await board("", residentCookie))).toEqual({ error: "FORBIDDEN" });
  });

  it("CL3 staff without complaints:manage are 403 on the manage routes, and manage alone is 403 on acknowledge and close", async () => {
    for (const attempt of [() => board("", priyaCookie), () => staffGet(ZERO, priyaCookie), () => staffUsers(priyaCookie), () => assignTo(ZERO, priyaCookie, {}), () => status(ZERO, priyaCookie, {}), () => comment(ZERO, priyaCookie, {}), () => category(ZERO, priyaCookie, {}), () => acknowledge(ZERO, priyaCookie), () => close(ZERO, priyaCookie, {})]) {
      expect((await attempt()).status).toBe(403);
    }
    expect((await acknowledge(ZERO, kavitaCookie)).status).toBe(403);
    expect((await close(ZERO, kavitaCookie, { note: "Gas isolated" })).status).toBe(403);
    expect((await acknowledge(ZERO, sanjayCookie)).status).toBe(404);
    expect(await world.ownerPrisma.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: world.staff.priya.id } })).toBeGreaterThanOrEqual(9);
  });
});

describe("CL3 the status mapping and the bodies", () => {
  it("CL3 raising: 201, then 200 for a repeat, 422 VALIDATION for a bad body, 422 NO_FLAT, and the answers hold only what they should", async () => {
    const created = await create(residentCookie, { body: "Water leak under the sink" });
    expect(created.status).toBe(201);
    const first = await json(created);
    expect(first).toMatchObject({ status: "OK", duplicate: false, complaint: { status: "ASSIGNED", category: "PLUMBING", assigned: true, safetyFlag: false } });
    expect(JSON.stringify(first)).not.toContain(world.staff.kavita.id);
    const again = await create(residentCookie, { body: "Water leak under the sink" });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ duplicate: true });
    for (const [label, bad] of [["blank", { body: "  " }], ["extra key", { body: "x", flatId: ZERO }], ["not text", { body: 5 }], ["too long", { body: "x".repeat(2001) }], ["missing", {}]] as const) {
      const response = await create(residentCookie, bad);
      expect([response.status, await json(response)], label).toEqual([422, { error: "VALIDATION" }]);
    }
    expect([(await create(residentCookie, undefined, "{not json")).status, (await create(residentCookie, undefined, "x".repeat(20_001))).status]).toEqual([422, 422]);
    const lapsed = await makeResident(world);
    await world.ownerPrisma.flatMember.updateMany({ where: { userId: lapsed.user.id }, data: { endsOn: new Date("2026-02-01T00:00:00Z") } });
    const noFlat = await create(await world.signIn(lapsed.user.id, "RESIDENT", NOW), { body: "Water leak under the sink" });
    expect([noFlat.status, await json(noFlat)]).toEqual([422, { error: "NO_FLAT" }]);
  });

  it("CL3 the resident loop over HTTP: list, read, a foreign id is 404, confirm 200 then 409, reopen needs a reason", async () => {
    const created = await json(await create(residentCookie, { body: "Corridor light is out" }));
    const id = (created.complaint as { id: string }).id;
    const list = await json(await listOwn(residentCookie));
    expect((list.complaints as { id: string }[]).map((c) => c.id)).toContain(id);
    expect(await json(await listOwn(otherResidentCookie))).toEqual({ status: "OK", complaints: [] });
    expect((await getOwn(id, residentCookie)).status).toBe(200);
    for (const target of [id, ZERO, "not-a-uuid"]) {
      expect([(await getOwn(target, otherResidentCookie)).status, (await confirm(target, otherResidentCookie)).status, (await reopen(target, otherResidentCookie, { reason: "Still not fixed" })).status], target).toEqual([404, 404, 404]);
    }
    expect(await json(await getOwn(id, otherResidentCookie))).toEqual({ error: "NOT_FOUND" });
    expect((await confirm(id, residentCookie)).status).toBe(409);
    await arrange(world, id, { status: "PENDING_CONFIRMATION", pendingConfirmationAt: new Date(NOW - DAY), firstResponseAt: new Date(NOW - DAY) });
    expect([(await reopen(id, residentCookie, { reason: "no" })).status, (await reopen(id, residentCookie, {})).status, (await confirm(id, residentCookie, { rating: 9 })).status]).toEqual([422, 422, 422]);
    expect((await confirm(id, residentCookie, { rating: 5 })).status).toBe(200);
    expect(await json(await confirm(id, residentCookie, { rating: 5 }))).toEqual({ error: "INVALID_TRANSITION" });
    expect((await reopen(id, residentCookie, { reason: "Light is out again" })).status).toBe(200);
  });

  it("CL3 the staff routes: board lanes and pagination, detail, assign (409 STALE, 422 ASSIGNEE_INVALID), status, comment, category", async () => {
    const created = await json(await create(otherResidentCookie, { body: "Water leak under the bathroom sink" }));
    const id = (created.complaint as { id: string }).id;
    const boardJson = await json(await board("?lane=OPEN&limit=1", kavitaCookie));
    expect(boardJson).toMatchObject({ status: "OK", lane: "OPEN" });
    expect((boardJson.rows as unknown[]).length).toBe(1);
    expect((await board("?lane=NOPE", kavitaCookie)).status).toBe(422);
    expect((await board("?lane=OPEN&limit=0", kavitaCookie)).status).toBe(422);
    expect((await board("?lane=OPEN&cursor=junk", kavitaCookie)).status).toBe(422);
    expect((await board("", kavitaCookie)).status).toBe(200);
    const detail = await json(await staffGet(id, kavitaCookie));
    expect(detail).toMatchObject({ status: "OK", complaint: { id, version: 1 } });
    expect((await staffGet(ZERO, kavitaCookie)).status).toBe(404);
    expect((await staffGet("nope", kavitaCookie)).status).toBe(404);
    expect(await json(await staffUsers(kavitaCookie))).toMatchObject({ status: "OK", users: [{ name: "Kavita Rao" }, { name: "Sanjay Pawar" }] });

    expect((await assignTo(id, kavitaCookie, { assigneeUserId: world.staff.sanjay.id, expectedVersion: 9 })).status).toBe(409);
    expect(await json(await assignTo(id, kavitaCookie, { assigneeUserId: world.staff.priya.id, expectedVersion: 1 }))).toEqual({ error: "ASSIGNEE_INVALID" });
    expect((await assignTo(id, kavitaCookie, { assigneeUserId: "bad", expectedVersion: 1 })).status).toBe(422);
    expect((await assignTo(id, kavitaCookie, { assigneeUserId: world.staff.sanjay.id, expectedVersion: 1, extra: true })).status).toBe(422);
    expect((await assignTo(id, kavitaCookie, { assigneeUserId: world.staff.sanjay.id, expectedVersion: 1 })).status).toBe(200);
    expect((await status(id, kavitaCookie, { status: "IN_PROGRESS", expectedVersion: 2 })).status).toBe(200);
    expect((await status(id, kavitaCookie, { status: "IN_PROGRESS", expectedVersion: 3 })).status).toBe(409);
    expect((await status(id, kavitaCookie, { status: "CLOSED", expectedVersion: 3 })).status).toBe(422);
    expect((await comment(id, kavitaCookie, { text: "Plumber is on the way", visibleToResident: true })).status).toBe(200);
    expect((await comment(id, kavitaCookie, { text: "", visibleToResident: true })).status).toBe(422);
    expect((await category(id, kavitaCookie, { category: "LIFT", expectedVersion: 3 })).status).toBe(200);
    expect((await category(id, kavitaCookie, { category: "GARDEN", expectedVersion: 4 })).status).toBe(422);
    expect((await category(id, kavitaCookie, { category: "ELECTRICAL", expectedVersion: 3 })).status).toBe(409);
    expect((await status(id, kavitaCookie, { status: "PENDING_CONFIRMATION", note: "Fixed", expectedVersion: 4 })).status).toBe(200);
  });

  it("CL3 the duty manager's routes: acknowledge, close (422 without a note, 409 twice), and a non-safety complaint is 409", async () => {
    const safety = await json(await create(residentCookie, { body: "There is a fire in the basement" }));
    const id = (safety.complaint as { id: string }).id;
    expect(safety).toMatchObject({ complaint: { urgency: "CRITICAL", status: "ASSIGNED", safetyFlag: true } });
    const board1 = await json(await board("?lane=SAFETY", sanjayCookie));
    expect((board1.rows as { id: string; assignee: { name: string } }[]).find((r) => r.id === id)?.assignee.name).toBe("Sanjay Pawar");
    expect((await acknowledge(id, sanjayCookie)).status).toBe(200);
    expect((await acknowledge(id, sanjayCookie, { x: 1 })).status).toBe(422);
    expect((await close(id, sanjayCookie, { note: "" })).status).toBe(422);
    expect((await close(id, sanjayCookie, { note: "Fire out, building safe" })).status).toBe(200);
    expect((await close(id, sanjayCookie, { note: "Fire out, building safe" })).status).toBe(409);
    const plain = await json(await create(residentCookie, { body: "Dustbin is overflowing" }));
    expect((await close((plain.complaint as { id: string }).id, sanjayCookie, { note: "Closing this" })).status).toBe(409);
  });

  it("CL3 every refusal is only a fixed code: no stack, no id, no row data", async () => {
    const responses = [await staffGet(ZERO, kavitaCookie), await board("?lane=NOPE", kavitaCookie), await create(residentCookie, { body: "" }), await getOwn(ZERO, residentCookie)];
    for (const response of responses) {
      const body = await response.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(String(body.error)).toMatch(/^[A-Z_]+$/);
    }
  });
});
