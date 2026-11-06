import { redirect } from "next/navigation";
import { auditDenied, authorize, isAllowed, type Need } from "./guard";
import type { AuthRouteDeps } from "./handlers";
import { safeReturnPath } from "./return-url";
import type { SessionUser } from "./session-service";

/** Where a person with the wrong role is sent. The page itself is built with the UI. */
export const FORBIDDEN_PATH = "/forbidden";
export const LOGIN_PATH = "/login";

/** The login address that comes back to `returnTo` afterwards. Only a same-site path is kept (src/server/auth/return-url.ts). */
export const loginPath = (returnTo?: string): string => `${LOGIN_PATH}?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;

export type AccessDecision = { kind: "ok"; user: SessionUser } | { kind: "login" } | { kind: "forbidden" };

/** The pure rule behind requireUser: no user means log in; a user who does not meet `need` is forbidden. */
export function decideAccess(user: SessionUser | null, need: Need = "ANY_USER"): AccessDecision {
  if (user === null) return { kind: "login" };
  return isAllowed(user, need) ? { kind: "ok", user } : { kind: "forbidden" };
}

/**
 * For Server Components and pages: the signed-in user, or a redirect. `getUser` is passed in so the logic can be
 * tested without a request. Redirects throw, as `redirect()` does in Next.js, so the code after it never runs.
 */
export async function requireUserWith(getUser: () => Promise<SessionUser | null>, options: { need?: Need; returnTo?: string } = {}): Promise<SessionUser> {
  const decision = decideAccess(await getUser(), options.need);
  if (decision.kind === "login") redirect(loginPath(options.returnTo));
  if (decision.kind === "forbidden") redirect(FORBIDDEN_PATH);
  return decision.user;
}

export type ActionContext = { user: SessionUser; sessionId: string; now: number; deps: AuthRouteDeps };
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: "UNAUTHENTICATED" | "FORBIDDEN" };

/**
 * The rules of withPermission for a server action, with the request details passed in. No session gives
 * UNAUTHENTICATED; a person without `need` gives FORBIDDEN and an ACCESS_DENIED audit row (the method is recorded as
 * ACTION, and the path comes from the Referer, or "unknown"). The action runs only for a person who passes.
 * Next.js already compares Origin and Host for every Server Action, so there is no CSRF check here.
 */
export async function runAction<A extends unknown[], T>(
  deps: AuthRouteDeps,
  request: { cookie: string | null; referer: string | null; ipHeaders: Headers },
  need: Need,
  action: (context: ActionContext, ...args: A) => Promise<T>,
  args: A,
): Promise<ActionResult<T>> {
  const now = deps.now();
  const result = await authorize(deps, request.cookie, need, now);
  if (!result.ok && result.status === 401) return { ok: false, error: "UNAUTHENTICATED" };
  if (!result.ok) {
    await auditDenied(deps, new Request(refererUrl(request.referer), { method: "ACTION", headers: request.ipHeaders }), result.user, need, now);
    return { ok: false, error: "FORBIDDEN" };
  }
  return { ok: true, data: await action({ user: result.user, sessionId: result.sessionId, now, deps }, ...args) };
}

function refererUrl(referer: string | null): string {
  try {
    const url = new URL(referer ?? "");
    return `http://action.invalid${url.pathname}`;
  } catch {
    return "http://action.invalid/unknown";
  }
}
