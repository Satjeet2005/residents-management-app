const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

type Env = { NODE_ENV?: string };

const isProduction = (env: Env): boolean => env.NODE_ENV === "production";

/**
 * `__Host-session` in production: the __Host- prefix makes a browser accept the cookie only when it is
 * Secure, has Path=/ and has no Domain, so a sibling subdomain cannot plant or replace it.
 * `session` elsewhere, because a __Host- cookie needs https and local development uses http://localhost.
 */
export function sessionCookieName(env: Env = process.env): string {
  return isProduction(env) ? "__Host-session" : "session";
}

function attributes(env: Env, maxAgeSeconds: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isProduction(env)) parts.push("Secure");
  return parts.join("; ");
}

/** The Set-Cookie value for a new session. Max-Age is the time left until the absolute end of the session. */
export function buildSessionCookie(token: string, expiresAt: number, now: number, env: Env = process.env): string {
  const maxAge = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${sessionCookieName(env)}=${token}; ${attributes(env, maxAge)}`;
}

/** The Set-Cookie value that removes the cookie: same name and attributes, empty value, Max-Age=0. */
export function clearSessionCookie(env: Env = process.env): string {
  return `${sessionCookieName(env)}=; ${attributes(env, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** The session token in a Cookie request header, or null. A value that is not a 43-character base64url token is ignored. */
export function readSessionToken(cookieHeader: string | null, env: Env = process.env): string | null {
  if (cookieHeader === null) return null;
  const name = sessionCookieName(env);
  for (const part of cookieHeader.split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : null;
  }
  return null;
}

/** Is a cookie of the session name present at all, whatever its value? Used to clear a stale or garbled one. */
export function hasSessionCookie(cookieHeader: string | null, env: Env = process.env): boolean {
  if (cookieHeader === null) return false;
  const name = sessionCookieName(env);
  return cookieHeader.split(";").some((part) => part.slice(0, Math.max(part.indexOf("="), 0)).trim() === name);
}
