import { z } from "zod";
import type { GuardContext } from "@/server/auth/guard";
import { businessNow } from "@/server/clock";
import { approveRequest, ignoreRow, rejectRequest } from "./approval";
import { type ManualError } from "./manual-core";
import { postManualMatch } from "./manual";
import { LANES, getRowReview, listImports, listRows, searchFlats } from "./review";

type Context = Pick<GuardContext, "user" | "deps" | "request">;
type Env = Readonly<Record<string, string | undefined>>;

const MAX_BODY_CHARS = 10_000;
const json = (status: number, body: unknown): Response => Response.json(body, { status });
const idSchema = z.uuid();

/** The status of each refusal. The body is only the fixed code: no detail, no row data. */
const STATUS: Record<ManualError, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  STALE: 409,
  NOT_QUEUED: 409,
  NOT_AWAITING_APPROVAL: 409,
  STATE_CHANGED: 409,
  SELF_APPROVAL: 409,
  NO_OPEN_BILL: 422,
  NEEDS_ADVANCE_HANDLING: 422,
  REASON_REQUIRED: 422,
  FLAT_NOT_FOUND: 422,
};
const refused = (error: ManualError): Response => json(STATUS[error], { error });

/** The id in `/api/<...>/<id>/<tail>`: the path segment `fromEnd` places from the end. A bad id is a 404 for the caller. */
function idAt(request: Request, fromEnd: number): string | null {
  const parsed = idSchema.safeParse(new URL(request.url).pathname.split("/").filter(Boolean).at(-1 - fromEnd));
  return parsed.success ? parsed.data : null;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const decimal = z.string().regex(/^[0-9]{1,18}$/);
const matchBody = z.strictObject({ flatCode: z.string().min(1).max(20), reason: z.string().max(2000), rememberPayer: z.boolean().default(false), expectedVersion: z.number().int().min(1).max(1_000_000), expectedAmountDuePaise: decimal.optional() });
const ignoreBody = z.strictObject({ reason: z.string().max(2000), expectedVersion: z.number().int().min(1).max(1_000_000) });
const approveBody = z.strictObject({ note: z.string().max(2000).optional() });
const rejectBody = z.strictObject({ reason: z.string().max(2000) });

/** GET /api/statements: the latest imports, newest first. */
export async function handleListImports(context: Context): Promise<Response> {
  return json(200, { imports: await listImports({ db: context.deps.db, limit: 10 }) });
}

/** GET /api/statements/[id]/rows?lane=&cursor=&limit=: one lane of one import, a page at a time. */
export async function handleListRows(context: Context): Promise<Response> {
  const importId = idAt(context.request, 1);
  const url = new URL(context.request.url);
  const lane = z.enum(LANES).safeParse(url.searchParams.get("lane") ?? "NEEDS_YOU");
  const limit = z.coerce.number().int().min(1).max(50).safeParse(url.searchParams.get("limit") ?? "25");
  if (importId === null) return json(404, { error: "NOT_FOUND" });
  if (!lane.success || !limit.success) return json(400, { error: "INVALID_REQUEST" });
  const page = await listRows({ db: context.deps.db, importId, lane: lane.data, cursor: url.searchParams.get("cursor") ?? undefined, limit: limit.data });
  return page === null ? json(404, { error: "NOT_FOUND" }) : json(200, page);
}

/** GET /api/bank-rows/[id]: the review of one row. */
export async function handleReview(context: Context, options: { env?: Env; now?: number } = {}): Promise<Response> {
  const rowId = idAt(context.request, 0);
  if (rowId === null) return json(404, { error: "NOT_FOUND" });
  const review = await getRowReview({ db: context.deps.db, rowId, now: options.now ?? businessNow(options.env ?? process.env) });
  return review === null ? json(404, { error: "NOT_FOUND" }) : json(200, review);
}

/** GET /api/flats/search?q=: at most 10 flats. */
export async function handleSearchFlats(context: Context, options: { env?: Env; now?: number } = {}): Promise<Response> {
  const q = z.string().max(100).safeParse(new URL(context.request.url).searchParams.get("q") ?? "");
  if (!q.success) return json(400, { error: "INVALID_REQUEST" });
  return json(200, { flats: await searchFlats({ db: context.deps.db, q: q.data, now: options.now ?? businessNow(options.env ?? process.env) }) });
}

/** POST /api/bank-rows/[id]/match. 200 `{ status: "POSTED" | "AWAITING_APPROVAL", ... }`. */
export async function handleMatch(context: Context, options: { now?: number } = {}): Promise<Response> {
  const rowId = idAt(context.request, 1);
  const body = matchBody.safeParse(await readBody(context.request));
  if (rowId === null) return json(404, { error: "NOT_FOUND" });
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });
  const result = await postManualMatch({
    db: context.deps.db,
    user: context.user,
    rowId,
    flatCode: body.data.flatCode,
    reason: body.data.reason,
    rememberPayer: body.data.rememberPayer,
    expectedVersion: body.data.expectedVersion,
    expectedAmountDuePaise: body.data.expectedAmountDuePaise === undefined ? undefined : BigInt(body.data.expectedAmountDuePaise),
    now: options.now ?? Date.now(),
  });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/bank-rows/[id]/ignore. */
export async function handleIgnore(context: Context, options: { now?: number } = {}): Promise<Response> {
  const rowId = idAt(context.request, 1);
  const body = ignoreBody.safeParse(await readBody(context.request));
  if (rowId === null) return json(404, { error: "NOT_FOUND" });
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });
  const result = await ignoreRow({ db: context.deps.db, user: context.user, rowId, reason: body.data.reason, expectedVersion: body.data.expectedVersion, now: options.now ?? Date.now() });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/bank-rows/[id]/approve. */
export async function handleApprove(context: Context, options: { now?: number } = {}): Promise<Response> {
  const rowId = idAt(context.request, 1);
  const body = approveBody.safeParse(await readBody(context.request));
  if (rowId === null) return json(404, { error: "NOT_FOUND" });
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });
  const result = await approveRequest({ db: context.deps.db, user: context.user, rowId, note: body.data.note, now: options.now ?? Date.now() });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/bank-rows/[id]/reject. */
export async function handleReject(context: Context, options: { now?: number } = {}): Promise<Response> {
  const rowId = idAt(context.request, 1);
  const body = rejectBody.safeParse(await readBody(context.request));
  if (rowId === null) return json(404, { error: "NOT_FOUND" });
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });
  const result = await rejectRequest({ db: context.deps.db, user: context.user, rowId, reason: body.data.reason, now: options.now ?? Date.now() });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}
