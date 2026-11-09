import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { autoCloseQuietly } from "@/server/complaints/auto-close";
import { assembleHome } from "./mapper";
import { findCurrentMemberships, loadBills, loadEntries, loadLatestAttempt, loadOpenComplaints, loadSettings } from "./queries";
import type { HomeData } from "./types";

/**
 * The resident Home, read-only. `now` is the business clock (src/server/clock.ts), passed in so tests control it. The flat
 * is the first current membership of the signed-in person (by flat code) and nothing else: no flat code, id or
 * parameter from a request is accepted, so one resident can never read another flat's data. Auto-close runs lazily first (D120), so a complaint that
 * waited long enough is already closed when the Home reads it; a failure there is logged and the page still loads.
 */
export async function getHomeData({ db, user, now }: { db: Db; user: Pick<SessionUser, "id" | "name">; now: number }): Promise<HomeData> {
  await autoCloseQuietly({ db, now });
  const today = istDateOf(now);
  const memberships = (await findCurrentMemberships(db, user.id, today)).sort((a, b) => (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0));
  const shown = memberships[0];
  if (shown === undefined) return assembleHome({ userName: user.name, now, memberships, bills: [], entries: [], complaints: [], settings: [], latestAttempt: null });
  const [bills, entries, complaints, settings, latestAttempt] = await Promise.all([
    loadBills(db, shown.flatId),
    loadEntries(db, shown.flatId),
    loadOpenComplaints(db, shown.flatId),
    loadSettings(db),
    loadLatestAttempt(db, shown.flatId),
  ]);
  return assembleHome({ userName: user.name, now, memberships, bills, entries, complaints, settings, latestAttempt });
}
