import { can, type Permission } from "@/domain/auth/permissions";
import { writeAccessDeniedAudit } from "./audit";
import { clientIp } from "./client-ip";
import { clearSessionCookies, hasSessionCookie, isHttps, readSessionToken } from "./cookie";
import { logRouteError } from "../log";
import { ipHash } from "./crypto";
import { csrfBlocked } from "./csrf";
import { defaultDeps } from "./default-deps";
import type { AuthRouteDeps } from "./handlers";
import { resolveSession, type SessionUser } from "./session-service";

/** What a route or action asks of the caller: one permission, any active staff, any resident, or anyone signed in. */
export type Need = Permission | "STAFF" | "RESIDENT" | "ANY_USER";

/** The one rule for who may pass. A permission is held only by active staff, through `can()` (D1). */
export function isAllowed(user: SessionUser, need: Need): boolean {
  switch (need) {
    case "ANY_USER":
      return true;
    case "STAFF":
      return user.role === "STAFF" && user.active;
    case "RESIDENT":
      return user.role === "RESIDENT" && user.active;
    default:
      return user.role === "STAFF" && can(user, need);
  }
}

export type Authorization =
  | { ok: true; user: SessionUser; sessionId: string }
  | { ok: false; status: 401; staleCookie: boolean }
  | { ok: false; status: 403; user: SessionUser };

/**
 * Who is behind this Cookie header, and may they do `need`? The session is read from the database on every call
 * (src/server/auth/session-service.ts), so a revoked session or a deactivated user stops working at once.
 * `staleCookie` is true when a session cookie was sent but is not valid, so the caller can clear it.
 */
export async function authorize(deps: AuthRouteDeps, request: { cookie: string | null; secure: boolean }, need: Need, now: number): Promise<Authorization> {
  const cookieHeader = request.cookie;
  const token = readSessionToken(cookieHeader, request.secure);
  const current = token === null ? null : await resolveSession(deps.db, token, now);
  if (current === null) return { ok: false, status: 401, staleCookie: hasSessionCookie(cookieHeader) };
  if (!isAllowed(current.user, need)) return { ok: false, status: 403, user: current.user };
  return { ok: true, user: current.user, sessionId: current.sessionId };
}

export type GuardContext = { user: SessionUser; sessionId: string; now: number; request: Request; deps: AuthRouteDeps };
export type PublicContext = { now: number; request: Request; deps: AuthRouteDeps };
export type RouteHandler = (request: Request) => Promise<Response>;

/** Every response says "do not store": none of these answers is for a shared cache or the back button. */
function finish(response: Response, extra: [string, string][] = []): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of extra) headers.append(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const error = (status: number, code: string, extra: [string, string][] = []): Response =>
  finish(Response.json({ error: code }, { status }), extra);

/** The path only: the query string can hold a search text or a phone number, so it is never logged. */
function routeOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

/** The two wrappers every route handler must use (D81). `createGuards` takes the dependencies so tests control the clock and database. */
export function createGuards(getDeps: () => AuthRouteDeps) {
  /** Anything unexpected becomes a plain 500 with no detail; the failure is logged with its redacted code and message (D111), never the request. */
  async function run(request: Request, work: () => Promise<Response>): Promise<Response> {
    try {
      return finish(await work());
    } catch (failure) {
      logRouteError(routeOf(request), failure);
      return error(500, "SERVER_ERROR");
    }
  }

  /**
   * An intentionally unauthenticated route (the allowlist is in tests/server/route-guards.test.ts). It gets the CSRF
   * check on unsafe methods and no-store, and nothing else.
   */
  function publicRoute(handler: (context: PublicContext) => Promise<Response> | Response): RouteHandler {
    return (request) =>
      run(request, async () => {
        if (csrfBlocked(request)) return error(403, "CSRF_BLOCKED");
        const deps = getDeps();
        return handler({ now: deps.now(), request, deps });
      });
  }

  /**
   * A route that needs a signed-in person. In this order: the CSRF check on unsafe methods; the session (401 and a
   * cleared stale cookie if there is none); the role or permission (403, audited as ACCESS_DENIED); then the handler.
   * It sets a cookie only to clear a stale one (both cookie names).
   */
  function withPermission(need: Need, handler: (context: GuardContext) => Promise<Response> | Response): RouteHandler {
    return (request) =>
      run(request, async () => {
        if (csrfBlocked(request)) return error(403, "CSRF_BLOCKED");
        const deps = getDeps();
        const now = deps.now();
        const result = await authorize(deps, { cookie: request.headers.get("cookie"), secure: isHttps(request) }, need, now);
        if (!result.ok && result.status === 401) {
          return error(401, "UNAUTHENTICATED", result.staleCookie ? clearSessionCookies().map((c): [string, string] => ["Set-Cookie", c]) : []);
        }
        if (!result.ok) {
          await auditDenied(deps, request, result.user, need, now);
          return error(403, "FORBIDDEN");
        }
        return handler({ user: result.user, sessionId: result.sessionId, now, request, deps });
      });
  }

  return { publicRoute, withPermission };
}

/**
 * A refusal is recorded even when the address cannot be hashed (D129): the row is written with no hash and `ipHashStatus: "unavailable"`, and the
 * failure is logged with a fixed message (never the address, the pepper or the error text). A failed audit write must not turn a 403 into a 500
 * either, so it is logged without data and the refusal stands.
 */
export async function auditDenied(deps: AuthRouteDeps, request: Request, user: SessionUser, need: Need, now: number): Promise<void> {
  let hash: string | null = null;
  try {
    hash = ipHash((deps.ip ?? clientIp)(request.headers));
  } catch {
    console.error("access denied audit: address hash unavailable");
  }
  try {
    await writeAccessDeniedAudit(deps.db, {
      userId: user.id,
      need,
      method: request.method,
      path: new URL(request.url).pathname,
      ipHash: hash,
      ...(hash === null ? { ipHashStatus: "unavailable" as const } : {}),
      now,
    });
  } catch {
    console.error("access denied audit failed");
  }
}

export const { publicRoute, withPermission } = createGuards(defaultDeps);
