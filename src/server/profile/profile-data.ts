import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { findCurrentMemberships } from "@/server/home/queries";
import type { FlatRelation } from "@/server/home/types";

export type ProfileData = {
  name: string;
  /** Only the last 4 digits of the phone are ever shown. */
  phoneMasked: string;
  role: "RESIDENT" | "STAFF";
  flats: { code: string; relation: FlatRelation }[];
};

/** "******3210": the last four digits and nothing else. */
export function maskPhoneForDisplay(phone: string): string {
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

/** The signed-in person's own profile: their name, masked phone, role, and the flats they belong to today (code and relation, sorted by code). */
export async function getProfileData({ db, user, now }: { db: Db; user: Pick<SessionUser, "id" | "name" | "phone" | "role">; now: number }): Promise<ProfileData> {
  const memberships = await findCurrentMemberships(db, user.id, istDateOf(now));
  const flats = memberships.map((m) => ({ code: m.flatCode, relation: m.relation })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { name: user.name, phoneMasked: maskPhoneForDisplay(user.phone), role: user.role, flats };
}
