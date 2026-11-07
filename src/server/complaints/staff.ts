import type { DbOrTx } from "@/server/auth/db";

/**
 * The duty manager: the active staff user with the permission `complaints:duty_manager`; with several, the one with the smallest name (compared as
 * plain text, then by id, so the answer never depends on the database's sort rules). Null when nobody holds it.
 */
export async function findDutyManager(db: DbOrTx): Promise<{ id: string; name: string } | null> {
  const holders = await db.user.findMany({
    where: { role: "STAFF", active: true, permissions: { some: { permission: "complaints:duty_manager" } } },
    select: { id: true, name: true },
  });
  holders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return holders[0] ?? null;
}

/** A person a complaint may be assigned to: an active STAFF user who holds `complaints:manage`. */
export async function isAssignable(db: DbOrTx, userId: string): Promise<boolean> {
  const count = await db.user.count({ where: { id: userId, role: "STAFF", active: true, permissions: { some: { permission: "complaints:manage" } } } });
  return count === 1;
}

/** The default assignee of a category, or null when there is none or that person can no longer take complaints. */
export async function findAssignableDefault(db: DbOrTx, userId: string | null): Promise<string | null> {
  return userId !== null && (await isAssignable(db, userId)) ? userId : null;
}
