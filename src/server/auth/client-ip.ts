/**
 * The address of the client, for rate limits only. One function, one rule.
 *
 * Vercel documents (vercel.com/docs/headers/request-headers) that `x-forwarded-for` is the public IP of the
 * client, that Vercel overwrites it and does not forward external values (to stop spoofing), and that
 * `x-vercel-forwarded-for` carries the same value but is not overwritten by a proxy placed in front of
 * Vercel. So on Vercel we read `x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`.
 *
 * Anywhere else (local development, tests, another host) those headers are set by the client and can be
 * forged, so they are not trusted and the answer is "unknown": all such requests share one bucket, which is
 * safe (the limits are stricter, not looser).
 */
export const UNKNOWN_IP = "unknown";
const HEADERS = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] as const;
/** IPv4 or IPv6 text: digits, hex letters, dots and colons, at most 45 characters. */
const LOOKS_LIKE_IP = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIp(headers: Pick<Headers, "get">, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.VERCEL !== "1") return UNKNOWN_IP;
  for (const name of HEADERS) {
    const first = headers.get(name)?.split(",")[0]?.trim();
    if (first && LOOKS_LIKE_IP.test(first)) return first.toLowerCase();
  }
  return UNKNOWN_IP;
}
