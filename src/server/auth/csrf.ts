/** Methods that change state. GET, HEAD and OPTIONS are safe and are never checked. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const isUnsafeMethod = (method: string): boolean => UNSAFE_METHODS.has(method.toUpperCase());

/** `Host: example.com:443` and `Origin: https://example.com` name the same site, so default ports are dropped. */
const normaliseHost = (host: string): string => host.trim().toLowerCase().replace(/:(80|443)$/, "");

/**
 * Is this state-changing request from another site? It is blocked when
 * - `Sec-Fetch-Site` is `cross-site` (a browser says the page that sent it is on another site), or
 * - `Origin` is present and its host (with port) is not the host the request was sent to.
 * An `Origin` of `null`, or one that is not a URL, is blocked. A request with no `Origin` is allowed: it is not
 * a browser form post or fetch from a page (a script, curl, a mobile client). The scheme is not compared, because
 * behind a proxy the app may see http while the browser used https; the `Host` header is compared instead.
 * Only the host decides, so `localhost.evil.com`, `localhost@evil.com` and `localhost:3001` do not match `localhost`.
 */
export function isCrossSiteRequest(headers: Pick<Headers, "get">, requestUrl: string): boolean {
  if (headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return true;
  const origin = headers.get("origin");
  if (origin === null) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  if (originHost === "") return true;
  const requestHost = headers.get("host") ?? new URL(requestUrl).host;
  return normaliseHost(originHost) !== normaliseHost(requestHost);
}

/** True when an unsafe request must be refused as a possible cross-site request forgery. Safe methods always pass. */
export function csrfBlocked(request: Request): boolean {
  return isUnsafeMethod(request.method) && isCrossSiteRequest(request.headers, request.url);
}
