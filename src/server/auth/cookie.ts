const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The cookie over https. The __Host- prefix makes a browser accept it only when it is Secure, has Path=/ and has no Domain. */
export const SECURE_COOKIE_NAME = "__Host-session";
/** The cookie over plain http (local use): a browser will not store a Secure or __Host- cookie from http://localhost. */
export const PLAIN_COOKIE_NAME = "session";

/**
 * Was this request made over https? True when the URL scheme is https, or the first value of `x-forwarded-proto` is
 * https (a proxy or Vercel terminated TLS and the app sees http). Case and spaces are ignored.
 *
 * It is the scheme, not NODE_ENV, that decides the cookie (D94). A client can send any `x-forwarded-proto`, but
 * the only thing it changes is the flags of the cookie in the response to that same client; no other person's cookie
 * or session is touched (docs/auth-design.md, "Cookie follows the request scheme"). On Vercel the platform sets the header.
 */
export function isHttpsRequest(input: { url?: string | null; forwardedProto?: string | null }): boolean {
  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  try {
    return input.url ? new URL(input.url).protocol === "https:" : false;
  } catch {
    return false;
  }
}

export const isHttps = (request: Request): boolean => isHttpsRequest({ url: request.url, forwardedProto: request.headers.get("x-forwarded-proto") });

/** The scheme of a request that has no URL to look at (a Server Component or action): the proxy header, or the page it came from. */
export function isHttpsFromHeaders(headers: Pick<Headers, "get">): boolean {
  return (
    isHttpsRequest({ forwardedProto: headers.get("x-forwarded-proto") }) ||
    ["referer", "origin"].some((name) => headers.get(name)?.toLowerCase().startsWith("https://") === true)
  );
}

/** `__Host-session` over https, `session` over http. */
export const sessionCookieName = (secure: boolean): string => (secure ? SECURE_COOKIE_NAME : PLAIN_COOKIE_NAME);

function attributes(secure: boolean, maxAgeSeconds: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The Set-Cookie value for a new session. Max-Age is the time left until the absolute end of the session. */
export function buildSessionCookie(token: string, expiresAt: number, now: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${sessionCookieName(secure)}=${token}; ${attributes(secure, maxAge)}`;
}

/** The Set-Cookie value that removes one cookie: same name and attributes, empty value, Max-Age=0. */
export function clearCookie(secure: boolean): string {
  return `${sessionCookieName(secure)}=; ${attributes(secure, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Both cookies cleared, whatever the scheme: a person who moves between http and https, or a stale cookie of either name, is cleaned up. */
export const clearSessionCookies = (): string[] => [clearCookie(false), clearCookie(true)];

/** Adds both clearing cookies to a set of headers (each as its own Set-Cookie line). */
export function appendClearedCookies(headers: Headers): Headers {
  for (const value of clearSessionCookies()) headers.append("Set-Cookie", value);
  return headers;
}

/** The session token in a Cookie request header, from the cookie whose name fits the request's scheme, or null. A value that is not a 43-character base64url token is ignored. */
export function readSessionToken(cookieHeader: string | null, secure: boolean): string | null {
  if (cookieHeader === null) return null;
  const name = sessionCookieName(secure);
  for (const part of cookieHeader.split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : null;
  }
  return null;
}

/** Is a cookie of either session name present at all, whatever its value? Used to clear a stale or garbled one. */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (cookieHeader === null) return false;
  return cookieHeader.split(";").some((part) => {
    const name = part.slice(0, Math.max(part.indexOf("="), 0)).trim();
    return name === PLAIN_COOKIE_NAME || name === SECURE_COOKIE_NAME;
  });
}
