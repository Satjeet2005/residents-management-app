/**
 * The durable error log (D135, D136). `reportError` writes the stdout line (src/server/log.ts) and stores ONE redacted row in error_events,
 * without ever delaying or changing the response: the store runs in Next's `after` (a route handler, a server component or an action), and
 * where `after` is not available (a script, a test) it is awaited for at most 300 ms.
 *
 * The app's database role may only INSERT into error_events (no SELECT), and an INSERT ... RETURNING needs SELECT, so the row is written with
 * a plain INSERT through `$executeRaw`, never `create()`. Flood protection is in memory per server instance.
 */
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { PrismaClient } from "../../generated/prisma/client";
import { codeOf, deploymentOf, describeError, clean, digestText, logError, logEvent, newRef, type ErrorContext, type LogSource } from "./log";

type Env = Readonly<Record<string, string | undefined>>;

/** What the writer needs from a database client: only the raw, no-RETURNING insert. */
export type ErrorLogDb = Pick<PrismaClient, "$executeRaw">;

/** How long a caller without `after` waits for the store. */
export const PERSIST_BUDGET_MS = 300;
export const MAX_EVENTS_PER_MINUTE = 20;
export const PER_FINGERPRINT_MS = 60_000;
const WINDOW_MS = 60_000;
const MAX_TRACKED_FINGERPRINTS = 500;
const MAX_TEXT = 100;

export type StoredEvent = {
  ref: string;
  level: "WARN" | "ERROR";
  source: LogSource;
  route: string;
  method: string | null;
  status: number | null;
  digest: string | null;
  requestId: string | null;
  userId: string | null;
  role: string | null;
  errorName: string;
  errorCode: string | null;
  message: string;
  stack: string | null;
  deployment: string | null;
  environment: string;
  fingerprint: string;
};

export type EventInput = {
  ref: string;
  level: "WARN" | "ERROR";
  source: LogSource;
  route: string;
  method?: string;
  status?: number;
  digest?: string;
  requestId?: string;
  userId?: string;
  role?: string;
  /** The thrown value, for an unexpected error. */
  error?: unknown;
  /** For a warning that has no thrown value: a fixed name and a short message. */
  errorName?: string;
  message?: string;
};

/** The first stack frame without its line and column numbers, so an edit to the file does not change the fingerprint. */
const withoutLineNumbers = (frame: string): string => frame.replace(/:\d+(?::\d+)?/g, "");

/** Ids in a path (a UUID or a number) are one route, not one per record. */
const normalizedRoute = (route: string): string => route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/[0-9]+(?=\/|$)/g, "/:id");

/** SHA-256 (hex) of the error name, the error code, the route and the first stack frame without line numbers: the same failure on the same route has the same value. */
export function fingerprintOf(parts: { errorName: string; errorCode: string | null; route: string; firstFrame: string | null }): string {
  const text = [parts.errorName, parts.errorCode ?? "", normalizedRoute(parts.route), withoutLineNumbers(parts.firstFrame ?? "")].join("\n");
  return createHash("sha256").update(text).digest("hex");
}

const optional = (value: string | undefined, env: Env): string | null => (value === undefined || value === "" ? null : clean(value, MAX_TEXT, env));

/** Builds the row: every text redacted and cut. The user id is kept only when it is a UUID (it goes into a uuid column). */
export function buildEvent(input: EventInput, env: Env = process.env): StoredEvent {
  const description = describeError(input.error ?? input.message ?? "", env);
  const errorName = input.errorName === undefined ? description.errorName : clean(input.errorName, MAX_TEXT, env);
  const route = clean(input.route, MAX_TEXT, env);
  return {
    ref: input.ref,
    level: input.level,
    source: input.source,
    route,
    method: optional(input.method, env),
    status: typeof input.status === "number" && Number.isInteger(input.status) ? input.status : null,
    digest: input.digest === undefined || input.digest === "" ? null : digestText(input.digest, env),
    requestId: optional(input.requestId, env),
    userId: input.userId !== undefined && /^[0-9a-f-]{36}$/i.test(input.userId) ? input.userId : null,
    role: optional(input.role, env),
    errorName,
    errorCode: input.error === undefined ? null : description.errorCode,
    message: description.message,
    stack: description.stack,
    deployment: deploymentOf(env),
    environment: clean(env.VERCEL_ENV ?? env.NODE_ENV ?? "unknown", MAX_TEXT, env),
    fingerprint: fingerprintOf({ errorName, errorCode: input.error === undefined ? null : description.errorCode, route, firstFrame: description.firstFrame }),
  };
}

/**
 * Flood protection, in memory: at most 20 stored events a minute in all, and at most 1 per fingerprint per 60 seconds. A skipped event is
 * counted, and the count goes into `suppressed_count` of the next row stored for that fingerprint.
 */
export class FloodGate {
  private readonly stored: number[] = [];
  private readonly byFingerprint = new Map<string, { lastAt: number; suppressed: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** `null` when the event is skipped (and counted); otherwise the number of events skipped since the last stored row of this fingerprint. */
  admit(fingerprint: string): number | null {
    const at = this.now();
    while (this.stored.length > 0 && at - this.stored[0] >= WINDOW_MS) this.stored.shift();
    const entry = this.byFingerprint.get(fingerprint) ?? { lastAt: Number.NEGATIVE_INFINITY, suppressed: 0 };
    if (this.stored.length >= MAX_EVENTS_PER_MINUTE || at - entry.lastAt < PER_FINGERPRINT_MS) {
      entry.suppressed += 1;
      this.remember(fingerprint, entry, at);
      return null;
    }
    const suppressed = entry.suppressed;
    this.stored.push(at);
    this.remember(fingerprint, { lastAt: at, suppressed: 0 }, at);
    return suppressed;
  }

  /** Puts the entry back (most recent last) and keeps the map small: an entry that is old and holds no count is dropped first. */
  private remember(fingerprint: string, entry: { lastAt: number; suppressed: number }, at: number): void {
    this.byFingerprint.delete(fingerprint);
    this.byFingerprint.set(fingerprint, entry);
    if (this.byFingerprint.size <= MAX_TRACKED_FINGERPRINTS) return;
    for (const [key, value] of this.byFingerprint) {
      if (value.suppressed === 0 && at - value.lastAt >= PER_FINGERPRINT_MS) this.byFingerprint.delete(key);
    }
    while (this.byFingerprint.size > MAX_TRACKED_FINGERPRINTS) this.byFingerprint.delete(this.byFingerprint.keys().next().value as string);
  }
}

const instanceGate = new FloodGate();

export type PersistOptions = { gate?: FloodGate; newRef?: () => string; env?: Env };

/** Postgres says 23505; Prisma wraps a raw query's failure as P2010 and carries the SQLSTATE in `meta` or the message. */
function isUniqueViolation(failure: unknown): boolean {
  try {
    if (typeof failure !== "object" || failure === null) return false;
    const { code, message, meta, cause } = failure as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
    return /23505|duplicate key value/i.test(`${String(code ?? "")} ${String(message ?? "")} ${JSON.stringify(meta ?? {})} ${JSON.stringify(cause ?? {})}`);
  } catch {
    return false;
  }
}

async function insert(db: ErrorLogDb, event: StoredEvent, suppressed: number): Promise<void> {
  await db.$executeRaw`INSERT INTO error_events
    (ref, level, source, route, method, status, digest, request_id, user_id, role, error_name, error_code, message, stack, deployment, environment, fingerprint, suppressed_count)
    VALUES (${event.ref}, ${event.level}, ${event.source}, ${event.route}, ${event.method}, ${event.status}, ${event.digest}, ${event.requestId}, ${event.userId}::uuid, ${event.role},
      ${event.errorName}, ${event.errorCode}, ${event.message}, ${event.stack}, ${event.deployment}, ${event.environment}, ${event.fingerprint}, ${suppressed})`;
}

/**
 * Stores one event. It NEVER throws. A unique violation on the reference (SQLSTATE 23505) is retried once with a new reference. When the database
 * cannot be written, one value-free line says so (the full line is already on stdout), and nothing else happens.
 */
export async function persistError(event: StoredEvent, db: ErrorLogDb, options: PersistOptions = {}): Promise<void> {
  try {
    // A test event is asked for by the developer and is limited by its own route (5 an hour), so the flood gate must not hide it.
    const suppressed = event.source === "TEST" ? 0 : (options.gate ?? instanceGate).admit(event.fingerprint);
    if (suppressed === null) return;
    try {
      await insert(db, event, suppressed);
    } catch (failure) {
      if (!isUniqueViolation(failure)) throw failure;
      const ref = (options.newRef ?? newRef)();
      logEvent({ level: "warn", source: "JOB", msg: "error reference collided, stored again", ref }, options.env);
      await insert(db, { ...event, ref }, suppressed);
    }
  } catch (failure) {
    logEvent({ level: "warn", source: "JOB", msg: "error event not stored", ref: event.ref, code: codeOf(failure) }, options.env);
  }
}

/** Runs the work after the response; where `after` is not available, waits for it for at most the budget. Never throws. */
export async function defer(work: () => Promise<void>, budgetMs: number = PERSIST_BUDGET_MS): Promise<void> {
  try {
    after(work);
    return;
  } catch {
    // Not in a request (a script, a test): fall through to the bounded wait.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  try {
    await Promise.race([work(), budget]);
  } catch {
    // The work reports its own failure; a rejection here must not reach the response.
  } finally {
    clearTimeout(timer);
  }
}

export type ReportOptions = PersistOptions & { budgetMs?: number };

/**
 * The one call for an unexpected error: one line on stdout, one row in error_events, and the reference to show the person. It never throws and
 * never waits longer than the budget; the reference is returned even when nothing could be stored.
 */
export async function reportError(error: unknown, context: ErrorContext & Pick<EventInput, "userId" | "role">, db: ErrorLogDb, options: ReportOptions = {}): Promise<string> {
  const ref = logError(error, context, options.env);
  try {
    const event = buildEvent({ ...context, ref, level: "ERROR", route: context.route ?? "unknown", error }, options.env);
    await defer(() => persistError(event, db, options), options.budgetMs);
  } catch {
    // The reference is already on stdout; nothing here may reach the response.
  }
  return ref;
}

/** A warning of the small fixed set (a breaker opened, retries exhausted, an import that did not balance). Same rules as `reportError`. */
export async function reportWarning(input: { source: LogSource; route: string; errorName: string; message: string }, db: ErrorLogDb, options: ReportOptions = {}): Promise<string> {
  const ref = newRef();
  logEvent({ level: "warn", source: input.source, msg: input.message, ref, route: input.route, errorName: input.errorName }, options.env);
  try {
    const event = buildEvent({ ...input, ref, level: "WARN" }, options.env);
    await defer(() => persistError(event, db, options), options.budgetMs);
  } catch {
    // Stdout has it.
  }
  return ref;
}

const warnedAt = new Map<string, number>();

/**
 * A warning of the fixed set that is stored at most once per cooldown per server instance (a breaker that keeps failing, an address hash that is
 * always missing). `Infinity` means once per instance. Returns whether the warning was sent. It never throws.
 */
export function warnOnce(key: string, cooldownMs: number, input: Parameters<typeof reportWarning>[0], db: ErrorLogDb, options: ReportOptions & { now?: () => number } = {}): boolean {
  try {
    const at = (options.now ?? Date.now)();
    const last = warnedAt.get(key);
    if (last !== undefined && at - last < cooldownMs) return false;
    warnedAt.set(key, at);
    void reportWarning(input, db, options);
    return true;
  } catch {
    return false;
  }
}

/** Test support: forgets which warnings were sent. */
export function resetWarnOnce(): void {
  warnedAt.clear();
}
