/**
 * The error-log test route (D135, D136): a way for the developer to prove, on a live deployment, that an event is stored and can be found with
 * `npm run logs:errors`. It does not exist unless OPS_TEST_TOKEN is set to at least 32 characters, and it answers a plain 404 to everyone else (never
 * a 401, so it cannot be told from a route that is not there). With the right token in `x-ops-token` it stores ONE test event and returns its reference.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { reportWarning, type ErrorLogDb } from "../error-log";

export const MIN_TOKEN_CHARS = 32;
export const MAX_CALLS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

type Env = Readonly<Record<string, string | undefined>>;

/** Compares the SHA-256 of both texts, so the comparison takes the same time whatever the lengths and the first different character. */
function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const notFound = (): Response => new Response(null, { status: 404 });

/** The handler, with its own counter of calls (per server instance). Only calls with the right token count, so a stranger cannot use up the allowance. */
export function createErrorTestHandler(options: { env?: Env; now?: () => number } = {}) {
  const calls: number[] = [];
  return async function handle(request: Request, db: ErrorLogDb): Promise<Response> {
    const env = options.env ?? process.env;
    const token = env.OPS_TEST_TOKEN;
    if (token === undefined || token.length < MIN_TOKEN_CHARS) return notFound();
    const given = request.headers.get("x-ops-token");
    if (given === null || !sameToken(given, token)) return notFound();
    const at = (options.now ?? Date.now)();
    while (calls.length > 0 && at - calls[0] >= HOUR_MS) calls.shift();
    if (calls.length >= MAX_CALLS_PER_HOUR) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
    calls.push(at);
    const ref = await reportWarning({ source: "TEST", route: "/api/ops/error-test", errorName: "OpsTest", message: "ops test" }, db, { env });
    return Response.json({ ref });
  };
}
