import { type AgeBucket, type AgeingRow, ageingRows } from "@/domain/reports/age";
import { istDateOf } from "@/domain/time/calendar";
import { AGEING_PAGE_SIZE, decodeCursor, pageAfter } from "@/lib/reports/cursor";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { requirePermission } from "@/server/statements/ui-data";
import { loadReportPositions } from "./positions";

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

/** One row of the drill-down as the page and the "Load more" action carry it: the amount is a decimal string, so it crosses to the browser as it stands. No name, no phone. */
export type AgeingRowView = { billId: string; flatCode: string; period: string; daysPastDue: number; amountDuePaise: string };

export type AgeingPage = { bucket: AgeBucket; rows: AgeingRowView[]; nextCursor: string | null };

const view = (row: AgeingRow): AgeingRowView => ({ billId: row.billId, flatCode: row.flatCode, period: row.period, daysPastDue: row.daysPastDue, amountDuePaise: row.amountDuePaise.toString() });

/**
 * One page of a bucket's drill-down, after `cursor` (the first page when there is none): the oldest first, 25 at a time. It reads the same positions as the report
 * (three queries) and takes the page in memory, so the amounts are the ones the buckets add up from. A cursor that is not one is `null` (the caller refuses it).
 */
export async function loadAgeingPage(input: { db: Db; user: Viewer; bucket: AgeBucket; cursor?: string; now: number }): Promise<AgeingPage | null> {
  requirePermission(input.user, "reports:view");
  const place = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && place === null) return null;
  const asOf = istDateOf(input.now);
  const { positions } = await loadReportPositions(input.db, asOf);
  const page = pageAfter(ageingRows(positions, asOf, input.bucket), place, AGEING_PAGE_SIZE);
  return { bucket: input.bucket, rows: page.rows.map(view), nextCursor: page.nextCursor };
}
