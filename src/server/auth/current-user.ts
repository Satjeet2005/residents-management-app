import { cache } from "react";
import { headers } from "next/headers";
import { requireUserWith, runAction, type ActionContext, type ActionResult } from "./access";
import { isHttpsFromHeaders, readSessionToken } from "./cookie";
import { defaultDeps } from "./default-deps";
import type { Need } from "./guard";
import { resolveSession, type SessionUser } from "./session-service";

/**
 * The signed-in user for this request, or null. React's `cache` shares the answer inside one render, so a page and its
 * components ask the database once. It does not help Server Actions or Route Handlers (Next.js authentication guide),
 * which is fine: each of them checks for itself. The session is read from the database every time, so revoking or
 * deactivating takes effect on the next request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const requestHeaders = await headers();
  const token = readSessionToken(requestHeaders.get("cookie"), isHttpsFromHeaders(requestHeaders));
  if (token === null) return null;
  const deps = defaultDeps();
  return (await resolveSession(deps.db, token, deps.now()))?.user ?? null;
});

/** For pages and Server Components: the user, or a redirect to /login?returnTo=... (no session) or /forbidden (wrong role). */
export function requireUser(options: { need?: Need; returnTo?: string } = {}): Promise<SessionUser> {
  return requireUserWith(getCurrentUser, options);
}

/**
 * For Server Actions: `export const save = withPermissionAction("payments:match", async ({ user }, input) => ...)`.
 * Every action checks for itself, as the Next.js guide says, because an action is a public endpoint whatever page shows it.
 */
export function withPermissionAction<A extends unknown[], T>(
  need: Need,
  action: (context: ActionContext, ...args: A) => Promise<T>,
): (...args: A) => Promise<ActionResult<T>> {
  return async (...args) => {
    const requestHeaders = await headers();
    return runAction(defaultDeps(), { cookie: requestHeaders.get("cookie"), secure: isHttpsFromHeaders(requestHeaders), referer: requestHeaders.get("referer"), ipHeaders: requestHeaders }, need, action, args);
  };
}
