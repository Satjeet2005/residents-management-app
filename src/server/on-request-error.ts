/**
 * Next's `onRequestError` hook (src/instrumentation.ts) lands here: an exception from a server component, a server action or a route handler
 * that the route guard did not catch. The digest is the number the browser shows on the error page, so it ties what a person sees to the row.
 * Only the route's file path, the method and the digest are used. The request's headers, cookies and body are never read, and the error's message and
 * stack are redacted before they are stored.
 */
import type { Instrumentation } from "next";
import { getDb } from "./db";
import { reportError, type ErrorLogDb } from "./error-log";
import type { LogSource } from "./log";

type Request = Parameters<Instrumentation.onRequestError>[1];
type Context = Parameters<Instrumentation.onRequestError>[2];

const SOURCE_OF: Readonly<Record<Context["routeType"], LogSource>> = { render: "PAGE", route: "ROUTE", action: "ACTION", proxy: "MIDDLEWARE" };

/** The digest Next attached to the error, if it did. */
function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  const { digest } = error;
  return typeof digest === "string" && digest !== "" ? digest : undefined;
}

/** The route file path (`/app/(staff)/staff/reports`), which has no ids in it; the request path without its query string is the fallback. */
const routeOf = (request: Request, context: Context): string => context.routePath || request.path.split("?")[0];

function errorLogDb(): ErrorLogDb {
  try {
    return getDb();
  } catch {
    return {} as ErrorLogDb;
  }
}

/** Stores one ERROR event for the failed request. It never throws. */
export async function recordRequestError(error: unknown, request: Request, context: Context, db: ErrorLogDb = errorLogDb()): Promise<void> {
  await reportError(error, { source: SOURCE_OF[context.routeType] ?? "ROUTE", route: routeOf(request, context), method: request.method, status: 500, digest: digestOf(error) }, db);
}
