import { authPolicy, type Role } from "@/domain/auth/policy";
import { evaluateSession, newSessionExpiry } from "@/domain/auth/session";
import { newSessionToken, sessionTokenHash } from "./crypto";
import type { Db } from "./db";

export type SessionUser = { id: string; role: Role; active: boolean; permissions: string[]; name: string; phone: string };

/**
 * Starts a session. Only the SHA-256 of the token is stored; the raw token is returned once, for the cookie,
 * and exists nowhere else. The end of the session is set by newSessionExpiry for the role.
 */
export async function createSession(db: Db, user: { id: string; role: Role }, now: number): Promise<{ token: string; sessionId: string; expiresAt: number }> {
  const token = newSessionToken();
  const expiresAt = newSessionExpiry(user.role, now, authPolicy);
  const session = await db.session.create({
    data: { userId: user.id, tokenHash: sessionTokenHash(token), expiresAt: new Date(expiresAt), lastSeenAt: new Date(now) },
    select: { id: true },
  });
  return { token, sessionId: session.id, expiresAt };
}

/**
 * Who is behind this token, or null. One query loads the session, the user and their permissions; the rules
 * in src/domain/auth decide. users.active is read on every request, so deactivating a person ends their
 * access at once without touching their sessions. last_seen_at is written only when the throttle has
 * passed, with one UPDATE. A token that is unknown, revoked, expired or whose user is inactive gives null,
 * and the caller cannot tell which.
 */
export async function resolveSession(db: Db, token: string, now: number): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (token === "") return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sessionTokenHash(token) },
    include: { user: { select: { id: true, name: true, phone: true, role: true, active: true, permissions: { select: { permission: true } } } } },
  });
  if (session === null) return null;
  const { user } = session;
  const decision = evaluateSession(
    {
      role: user.role,
      // sessions has no created_at column; the start is implied by the end and the role's absolute limit.
      createdAt: session.expiresAt.getTime() - authPolicy.session[user.role].absoluteSeconds * 1000,
      lastSeenAt: session.lastSeenAt.getTime(),
      absoluteExpiresAt: session.expiresAt.getTime(),
      revokedAt: session.revokedAt?.getTime() ?? null,
      userActive: user.active,
    },
    now,
    authPolicy,
  );
  if (!decision.valid) return null;
  if (decision.shouldTouch) await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  return { user: { id: user.id, role: user.role, active: user.active, name: user.name, phone: user.phone, permissions: user.permissions.map((p) => p.permission) }, sessionId: session.id };
}

/** Ends one session. Ending it twice changes nothing. */
export async function revokeSession(db: Db, sessionId: string, now: number): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(now) } });
}

/** Ends every session of one user, on every device. Returns how many were ended. */
export async function revokeAllSessions(db: Db, userId: string, now: number): Promise<number> {
  const result = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(now) } });
  return result.count;
}
