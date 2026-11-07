import type { DbOrTx } from "./db";

export const AUTH_ACTIONS = ["OTP_REQUESTED", "OTP_BLOCKED", "LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGOUT", "LOGOUT_ALL", "ACCESS_DENIED"] as const;
export type AuthAction = (typeof AUTH_ACTIONS)[number];

/** Only the last 4 digits of a national number, so an audit row cannot be used to find a person. */
export function maskPhone(national: string): string {
  return `******${national.slice(-4)}`;
}

/**
 * Appends one audit_log row about authentication. The detail holds a masked phone, the hash of the
 * address (never the address) and a reason key. It never holds a code, a token, the pepper or a full phone.
 * `userId` is the person the event is about, or null when the phone has no account.
 */
export async function writeAuthAudit(
  db: DbOrTx,
  entry: { action: AuthAction; userId: string | null; phone: string | null; ipHash: string | null; reason: string | null; now: number },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.userId,
      action: entry.action,
      entityType: "auth",
      entityId: entry.userId ?? "unknown",
      detail: {
        phone: entry.phone === null ? null : maskPhone(entry.phone),
        ipHash: entry.ipHash,
        reason: entry.reason,
      },
      createdAt: new Date(entry.now),
    },
  });
}

/**
 * Records that a signed-in person was refused (a 403). The detail holds what was needed, the method, the path
 * without its query string, and the address hash. It never holds the cookie, the token or the address (D82).
 * When the address could not be hashed the hash is null and `ipHashStatus` says "unavailable" (D129).
 * A 401 is not recorded: an unauthenticated request has no person to attribute it to, and anyone can send one.
 */
export async function writeAccessDeniedAudit(
  db: DbOrTx,
  entry: { userId: string; need: string; method: string; path: string; ipHash: string | null; ipHashStatus?: "unavailable"; now: number },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.userId,
      action: "ACCESS_DENIED",
      entityType: "auth",
      entityId: entry.userId,
      detail: { need: entry.need, method: entry.method, path: entry.path, ipHash: entry.ipHash, ...(entry.ipHashStatus === undefined ? {} : { ipHashStatus: entry.ipHashStatus }) },
      createdAt: new Date(entry.now),
    },
  });
}
