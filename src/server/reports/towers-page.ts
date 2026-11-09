import { towerRollup, type TowerRollup } from "@/domain/reports/towers";
import { type CalendarDate, istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { requirePermission } from "@/server/statements/ui-data";
import { loadReportPositions } from "./positions";

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

/** What the towers page shows: every tower with what it owes, the totals over all of them (the Total owed of the Dues page) and the date. */
export type TowersPage = { asOf: CalendarDate; rollup: TowerRollup };

/**
 * The towers page's data (D217): the same open positions as the age groups, so the towers add up to Total owed exactly. The permission is checked here, at the data
 * (the page has already sent anyone else away). Tower names and counts only: no flat code and no name.
 */
export async function loadTowersPage(input: { db: Db; user: Viewer; now: number }): Promise<TowersPage> {
  requirePermission(input.user, "reports:view");
  const asOf = istDateOf(input.now);
  const { positions } = await loadReportPositions(input.db, asOf);
  return { asOf, rollup: towerRollup(positions, asOf) };
}
