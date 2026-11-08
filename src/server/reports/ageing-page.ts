import { type AgeBucket, type AgeingFlatRow, type AgeingSort, ageingFlats } from "@/domain/reports/age";
import type { ReportPosition } from "@/domain/reports/positions";
import { type CalendarDate, istDateOf } from "@/domain/time/calendar";
import { AGEING_PAGE_SIZE, type AgeingPlace, decodeCursor, pageAfter } from "@/lib/reports/cursor";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { requirePermission } from "@/server/statements/ui-data";
import { loadReportPositions } from "./positions";

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

/** One flat of the drill-down as the page and the "Show more" action carry it: the amount is a decimal string, so it crosses to the browser as it stands. No name, no phone. */
export type AgeingRowView = { flatCode: string; bills: number; oldestDaysPastDue: number; amountDuePaise: string };

/** A page of the drill-down, with the whole group's flats and amount (for the heading "115 flats owe ₹7.5 lakh"). */
export type AgeingPage = { bucket: AgeBucket; sort: AgeingSort; flats: number; amountDuePaise: string; rows: AgeingRowView[]; nextCursor: string | null };

const view = (row: AgeingFlatRow): AgeingRowView => ({ flatCode: row.flatCode, bills: row.bills, oldestDaysPastDue: row.oldestDaysPastDue, amountDuePaise: row.amountDuePaise.toString() });

/** One page of a group's flats, after `place` (the first page when there is none), from positions already loaded: 25 at a time in the order asked for. */
export function ageingPageOf(positions: readonly ReportPosition[], asOf: CalendarDate, bucket: AgeBucket, sort: AgeingSort, place: AgeingPlace | null): AgeingPage {
  const all = ageingFlats(positions, asOf, bucket, sort);
  const page = pageAfter(all, sort, place, AGEING_PAGE_SIZE);
  return { bucket, sort, flats: all.length, amountDuePaise: all.reduce((sum, r) => sum + r.amountDuePaise, 0n).toString(), rows: page.rows.map(view), nextCursor: page.nextCursor };
}

/**
 * One page of a group's drill-down, after `cursor` (the first page when there is none): 25 flats at a time, largest first or oldest first. It reads the same positions
 * as the report (three queries) and takes the page in memory, so the amounts are the ones the groups add up from. A cursor that is not one, or that belongs to the
 * other order, is `null` (the caller refuses it).
 */
export async function loadAgeingPage(input: { db: Db; user: Viewer; bucket: AgeBucket; sort: AgeingSort; cursor?: string; now: number }): Promise<AgeingPage | null> {
  requirePermission(input.user, "reports:view");
  const place = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && (place === null || place.sort !== input.sort)) return null;
  const asOf = istDateOf(input.now);
  const { positions } = await loadReportPositions(input.db, asOf);
  return ageingPageOf(positions, asOf, input.bucket, input.sort, place);
}
