import { CLIENT_MESSAGE_KEYS } from "@/domain/auth/otp";
import { normalizePhone } from "@/domain/auth/phone";
import type { Role } from "@/domain/auth/policy";
import type { z } from "zod";
import { writeAuthAudit } from "./audit";
import { buildSessionCookie, clearSessionCookie, readSessionToken } from "./cookie";
import { ipHash } from "./crypto";
import type { Db } from "./db";
import { clientIp } from "./client-ip";
import { requestOtp, verifyOtp, type OtpSender } from "./otp-service";
import { safeReturnPath } from "./return-url";
import { MAX_BODY_CHARS, requestOtpBody, verifyOtpBody } from "./schemas";
import { createSession, resolveSession, revokeAllSessions, revokeSession } from "./session-service";

/** What the handlers need from outside: the database, the sender, the clock and where the address comes from. */
export type AuthRouteDeps = {
  db: Db;
  sender: OtpSender;
  now: () => number;
  ip?: (headers: Headers) => string;
};

/**
 * Response shapes (one rule for all four routes):
 * - success: 200 with a JSON body, or 204 with none;
 * - every refusal: a JSON body `{ error: KEY }` and no more. 400 for a bad body (INVALID_REQUEST), a bad
 *   phone format on a request (INVALID_PHONE), and a code that is not accepted or is locked (OTP_NOT_ACCEPTED,
 *   OTP_LOCKED); 429 with `retryAfterSeconds` and a Retry-After header (TOO_MANY_REQUESTS); 401 only for
 *   logout-all without a session.
 * A request for a code answers 200 for every valid phone, registered or not.
 */
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const refusal = (status: number, error: string): Response => json(status, { error });

const HOME: Record<Role, string> = { RESIDENT: "/", STAFF: "/staff" };

/** A browser always sends Origin on a POST. When it is present it must be this site: a cross-site page cannot call these routes. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const addressOf = (deps: AuthRouteDeps, request: Request): string => (deps.ip ?? clientIp)(request.headers);

export async function handleOtpRequest(deps: AuthRouteDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refusal(400, "INVALID_REQUEST");
  const body = await parseBody(request, requestOtpBody);
  if (body === null) return refusal(400, "INVALID_REQUEST");
  const result = await requestOtp(deps, { phoneInput: body.phone, ip: addressOf(deps, request), now: deps.now() });
  switch (result.status) {
    case "INVALID_PHONE":
      return refusal(400, "INVALID_PHONE");
    case "BLOCKED":
      return json(429, { error: CLIENT_MESSAGE_KEYS.tooManyRequests, retryAfterSeconds: result.retryAfterSeconds }, { "Retry-After": String(result.retryAfterSeconds) });
    case "SENT":
      return json(200, { message: result.message, retryAfterSeconds: result.retryAfterSeconds, ...(result.demoCode === undefined ? {} : { demoCode: result.demoCode }) });
  }
}

export async function handleOtpVerify(deps: AuthRouteDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refusal(400, "INVALID_REQUEST");
  const body = await parseBody(request, verifyOtpBody);
  if (body === null) return refusal(400, "INVALID_REQUEST");
  const ip = addressOf(deps, request);
  const now = deps.now();
  const result = await verifyOtp(deps, { phoneInput: body.phone, code: body.code, ip, now });
  if (result.status === "REFUSED") return refusal(400, result.message);

  const { user } = result;
  const session = await createSession(deps.db, user, now);
  await writeAuthAudit(deps.db, { action: "LOGIN_SUCCEEDED", userId: user.id, phone: normalizePhone(body.phone), ipHash: ipHash(ip), reason: null, now });
  const target = safeReturnPath(body.returnTo);
  return json(200, { role: user.role, redirectTo: target === "/" ? HOME[user.role] : target }, { "Set-Cookie": buildSessionCookie(session.token, session.expiresAt, now) });
}

/** Ends the session in the cookie. Always clears the cookie and answers 204, so it can be repeated and says nothing about the session. */
export async function handleLogout(deps: AuthRouteDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refusal(400, "INVALID_REQUEST");
  const now = deps.now();
  const token = readSessionToken(request.headers.get("cookie"));
  const current = token === null ? null : await resolveSession(deps.db, token, now);
  if (current !== null) {
    await revokeSession(deps.db, current.sessionId, now);
    await writeAuthAudit(deps.db, { action: "LOGOUT", userId: current.user.id, phone: current.user.phone, ipHash: ipHash(addressOf(deps, request)), reason: null, now });
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
}

/** Ends every session of the person in the cookie. Without a valid session it answers 401. */
export async function handleLogoutAll(deps: AuthRouteDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refusal(400, "INVALID_REQUEST");
  const now = deps.now();
  const token = readSessionToken(request.headers.get("cookie"));
  const current = token === null ? null : await resolveSession(deps.db, token, now);
  if (current === null) return json(401, { error: "UNAUTHENTICATED" }, { "Set-Cookie": clearSessionCookie() });
  await revokeAllSessions(deps.db, current.user.id, now);
  await writeAuthAudit(deps.db, { action: "LOGOUT_ALL", userId: current.user.id, phone: current.user.phone, ipHash: ipHash(addressOf(deps, request)), reason: null, now });
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
}
