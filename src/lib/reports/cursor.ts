import { z } from "zod";
import { type AgeingFlatRow, type AgeingSort, compareFlats } from "@/domain/reports/age";

export const AGEING_PAGE_SIZE = 25;

const cursorSchema = z.object({ s: z.enum(["LARGEST", "OLDEST"]), a: z.string().regex(/^\d{1,18}$/), d: z.number().int(), f: z.string().min(1).max(40), i: z.string().min(1).max(64) });

/** A place in the drill-down: the sort it belongs to and the row it follows. */
export type AgeingPlace = { sort: AgeingSort; row: AgeingFlatRow };

/** The place after a flat in the drill-down order, as an opaque text. */
export const encodeCursor = (sort: AgeingSort, row: AgeingFlatRow): string =>
  Buffer.from(JSON.stringify({ s: sort, a: row.amountDuePaise.toString(), d: row.oldestDaysPastDue, f: row.flatCode, i: row.flatId })).toString("base64url");

/** The place a cursor names, or null for anything that is not one (a bad cursor is refused, never guessed). */
export function decodeCursor(cursor: string): AgeingPlace | null {
  if (cursor.length > 300) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const { s, a, d, f, i } = parsed.data;
    return { sort: s, row: { flatId: i, flatCode: f, bills: 0, oldestDaysPastDue: d, amountDuePaise: BigInt(a) } };
  } catch {
    return null;
  }
}

/**
 * The flats that come strictly after the cursor in the drill-down order, at most `size` of them, and the cursor for the next page (null at the end). `rows` must be
 * in the order of `sort`. A cursor made for the other sort is not a place in this order: the caller refuses it.
 */
export function pageAfter(rows: readonly AgeingFlatRow[], sort: AgeingSort, place: AgeingPlace | null, size = AGEING_PAGE_SIZE): { rows: AgeingFlatRow[]; nextCursor: string | null } {
  const compare = compareFlats(sort);
  const after = place === null ? rows : rows.filter((r) => compare(r, place.row) > 0);
  const page = after.slice(0, size);
  const last = page.at(-1);
  return { rows: page, nextCursor: after.length > size && last !== undefined ? encodeCursor(sort, last) : null };
}
