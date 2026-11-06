import { istDateOf } from "@/domain/time/calendar";
import type { Role } from "@/domain/auth/policy";
import type { Db } from "./db";
import type { SessionUser } from "./session-service";

export type Me = { id: string; name: string; role: Role; permissions: string[]; flats: string[] };

/**
 * The codes of the flats this person belongs to today, sorted. A membership counts from `starts_on` and until
 * `ends_on` inclusive (or with no end). "Today" is the India Standard Time date of `now`.
 */
export async function currentFlatCodes(db: Db, userId: string, now: number): Promise<string[]> {
  const today = new Date(`${istDateOf(now)}T00:00:00.000Z`);
  const rows = await db.flatMember.findMany({
    where: { userId, startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
    select: { flat: { select: { code: true } } },
  });
  return [...new Set(rows.map((r) => r.flat.code))].sort();
}

/**
 * What the signed-in person may see about themselves: id, name, role, flats, and (staff only) permissions.
 * No phone number and nothing else: this is the one place a screen asks "who am I", so it returns the least it can.
 */
export async function buildMe(db: Db, user: SessionUser, now: number): Promise<Me> {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    permissions: user.role === "STAFF" ? [...user.permissions].sort() : [],
    flats: await currentFlatCodes(db, user.id, now),
  };
}
