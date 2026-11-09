import { z } from "zod";
import type { GuardContext } from "@/server/auth/guard";
import { businessNow } from "@/server/clock";
import { autoCloseQuietly } from "./auto-close";
import { type BoardView, DEFAULT_BOARD_VIEW, isBoardView } from "@/domain/complaints/board-views";
import { CATEGORY_CODES, URGENCIES } from "@/domain/complaints/taxonomy";
import { ASSIGNEE_FILTERS, flatCodePrefix } from "@/lib/staff-complaints/board-query";
import { listBoardView } from "./board-views";
import { VIEW_PAGE_SIZE } from "./page-size";
import type { Classifier } from "./classifier";
import { isUuid } from "./context";
import { createComplaint } from "./create";
import type { ComplaintError } from "./errors";
import { productionClassifier } from "./providers/factory";
import { getComplaint, listOwnComplaints } from "./read";
import { confirmFixed, reopen } from "./resident";
import { acknowledgeSafety, closeSafety } from "./safety";
import { getStaffComplaint, listStaffUsers } from "./staff-read";
import { addComment, assign, correctCategory, setStatus } from "./staff-actions";
import { withoutNul } from "@/server/request-text";

type Context = Pick<GuardContext, "user" | "deps" | "request">;
type Options = { now?: number; classifier?: Classifier };

/** The status of each refusal. The body is only the fixed code (no detail, no row data), and a complaint of another flat is a plain 404. */
export const COMPLAINT_STATUS: Record<ComplaintError, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE: 409,
  INVALID_TRANSITION: 409,
  NO_FLAT: 422,
  VALIDATION: 422,
  ASSIGNEE_INVALID: 422,
};

const json = (status: number, body: unknown): Response => Response.json(body, { status });
const refused = (error: ComplaintError): Response => json(COMPLAINT_STATUS[error], { error });
const invalid = (): Response => refused("VALIDATION");
const notFound = (): Response => refused("NOT_FOUND");

/** The complaints clock is the business clock (D97), like the Home, so "reply due" and the age of a complaint agree with what the Home shows. */
const clock = (options: Options): number => options.now ?? businessNow(process.env);

const MAX_BODY_CHARS = 20_000;

/** The id in `/api/<...>/<id>/<tail>`: the path segment `fromEnd` places from the end. Anything that is not a UUID is null (a 404 for the caller). */
function idAt(request: Request, fromEnd: number): string | null {
  const segment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1 - fromEnd);
  return segment !== undefined && isUuid(segment) ? segment : null;
}

/** The JSON body, `{}` when there is none, or null when it is too long or not JSON. */
async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const version = z.number().int().min(1).max(1_000_000);
const raiseBody = z.strictObject({ body: z.string().max(MAX_BODY_CHARS), declaredDanger: z.boolean().default(false) });
const confirmBody = z.strictObject({ rating: z.number().int().min(1).max(5).optional() });
const reopenBody = z.strictObject({ reason: withoutNul(z.string().max(5000)) });
const assignBody = z.strictObject({ assigneeUserId: z.uuid(), expectedVersion: version });
const statusBody = z.strictObject({ status: z.enum(["IN_PROGRESS", "PENDING_CONFIRMATION"]), note: withoutNul(z.string().max(5000)).optional(), expectedVersion: version });
const commentBody = z.strictObject({ text: withoutNul(z.string().max(5000)), visibleToResident: z.boolean() });
const categoryBody = z.strictObject({ category: z.enum(CATEGORY_CODES), expectedVersion: version });
const closeBody = z.strictObject({ note: withoutNul(z.string().max(5000)) });
const emptyBody = z.strictObject({});

/** Lazy auto-close (D120): the lists call it as they load. */
const lazyAutoClose = (context: Context, now: number): Promise<void> => autoCloseQuietly({ db: context.deps.db, now });

/** POST /api/complaints: 201 with the new complaint, or 200 with `duplicate: true` for a repeat within 60 seconds. */
export async function handleCreate(context: Context, options: Options = {}): Promise<Response> {
  const body = raiseBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await createComplaint({ db: context.deps.db, user: context.user, body: body.data.body, declaredDanger: body.data.declaredDanger, now: clock(options), classifier: options.classifier ?? productionClassifier() });
  return result.status === "ERROR" ? refused(result.error) : json(result.duplicate ? 200 : 201, result);
}

/** GET /api/complaints: the resident's own flat's complaints. */
export async function handleListOwn(context: Context, options: Options = {}): Promise<Response> {
  const now = clock(options);
  await lazyAutoClose(context, now);
  const result = await listOwnComplaints({ db: context.deps.db, user: context.user, now });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** GET /api/complaints/[id]. */
export async function handleGetOwn(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 0);
  if (id === null) return notFound();
  const result = await getComplaint({ db: context.deps.db, user: context.user, id, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/complaints/[id]/confirm. */
export async function handleConfirm(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = confirmBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await confirmFixed({ db: context.deps.db, user: context.user, id, rating: body.data.rating, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/complaints/[id]/reopen. */
export async function handleReopen(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = reopenBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await reopen({ db: context.deps.db, user: context.user, id, reason: body.data.reason, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** The old lane codes of `?lane=`, and the view each one became (D151). */
const LANE_CODES: Readonly<Record<string, BoardView>> = { NEEDS_TRIAGE: "triage", OPEN: "open", OVERDUE: "overdue", WAITING_RESIDENT: "waiting", SAFETY: "safety", CLOSED: "closed" };

const boardFilters = z.object({
  category: z.enum(CATEGORY_CODES).optional(),
  assignee: z.enum(ASSIGNEE_FILTERS).default("anyone"),
  urgency: z.enum(URGENCIES).optional(),
  q: withoutNul(z.string().max(8)).optional(),
});

/**
 * GET /api/staff/complaints?view=&category=&assignee=&urgency=&q=&cursor=&limit=: one view of the board, a page of 15 at a time, with the count of every view.
 * Unlike the page, the API is strict: an unknown view, filter value or flat code is 422. `lane=` (the old codes, such as OPEN) is accepted as the name of a view.
 */
export async function handleBoard(context: Context, options: Options = {}): Promise<Response> {
  const url = new URL(context.request.url);
  const lane = url.searchParams.get("lane");
  const view = url.searchParams.get("view") ?? (lane === null ? DEFAULT_BOARD_VIEW : Object.hasOwn(LANE_CODES, lane) ? LANE_CODES[lane] : null);
  const limit = z.coerce.number().int().min(1).max(50).safeParse(url.searchParams.get("limit") ?? String(VIEW_PAGE_SIZE));
  const filters = boardFilters.safeParse(Object.fromEntries([...url.searchParams].filter(([key]) => ["category", "assignee", "urgency", "q"].includes(key))));
  const q = filters.success && filters.data.q !== undefined ? flatCodePrefix(filters.data.q) : null;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!isBoardView(view) || !limit.success || !filters.success || (filters.data.q !== undefined && q === null) || (cursor !== undefined && cursor.length > 500)) return invalid();
  const now = clock(options);
  await lazyAutoClose(context, now);
  const result = await listBoardView({ db: context.deps.db, user: context.user, view, filters: { category: filters.data.category ?? null, assignee: filters.data.assignee, urgency: filters.data.urgency ?? null, q }, cursor, limit: limit.data, now });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** GET /api/staff/complaints/[id]. */
export async function handleStaffGet(context: Context): Promise<Response> {
  const id = idAt(context.request, 0);
  if (id === null) return notFound();
  const result = await getStaffComplaint({ db: context.deps.db, user: context.user, id });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** GET /api/staff/users: the people a complaint may be assigned to. */
export async function handleStaffUsers(context: Context): Promise<Response> {
  const result = await listStaffUsers({ db: context.deps.db, user: context.user });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/assign. */
export async function handleAssign(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = assignBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await assign({ db: context.deps.db, user: context.user, id, assigneeUserId: body.data.assigneeUserId, expectedVersion: body.data.expectedVersion, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/status. */
export async function handleSetStatus(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = statusBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await setStatus({ db: context.deps.db, user: context.user, id, status: body.data.status, note: body.data.note, expectedVersion: body.data.expectedVersion, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/comment. */
export async function handleComment(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = commentBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await addComment({ db: context.deps.db, user: context.user, id, text: body.data.text, visibleToResident: body.data.visibleToResident, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/category. */
export async function handleCategory(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = categoryBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await correctCategory({ db: context.deps.db, user: context.user, id, category: body.data.category, expectedVersion: body.data.expectedVersion, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/acknowledge: the duty manager has seen a safety complaint. */
export async function handleAcknowledge(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  if (!emptyBody.safeParse(await readBody(context.request)).success) return invalid();
  const result = await acknowledgeSafety({ db: context.deps.db, user: context.user, id, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}

/** POST /api/staff/complaints/[id]/close: the duty manager closes a safety complaint. */
export async function handleClose(context: Context, options: Options = {}): Promise<Response> {
  const id = idAt(context.request, 1);
  if (id === null) return notFound();
  const body = closeBody.safeParse(await readBody(context.request));
  if (!body.success) return invalid();
  const result = await closeSafety({ db: context.deps.db, user: context.user, id, note: body.data.note, now: clock(options) });
  return result.status === "ERROR" ? refused(result.error) : json(200, result);
}
