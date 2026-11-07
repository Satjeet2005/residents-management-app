import { z } from "zod";
import type { AgeingRow } from "@/domain/reports/age";

export const AGEING_PAGE_SIZE = 25;

const cursorSchema = z.object({ d: z.number().int(), f: z.string().min(1).max(40), b: z.string().min(1).max(64) });

/** The place after a row in the ageing drill-down order (oldest first, then flat code, then bill id), as an opaque text. */
export const encodeCursor = (row: Pick<AgeingRow, "daysPastDue" | "flatCode" | "billId">): string => Buffer.from(JSON.stringify({ d: row.daysPastDue, f: row.flatCode, b: row.billId })).toString("base64url");

/** The place a cursor names, or null for anything that is not one (a bad cursor is refused, never guessed). */
export function decodeCursor(cursor: string): { d: number; f: string; b: string } | null {
  if (cursor.length > 300) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The rows that come strictly after the cursor in the drill-down order, at most `size` of them, and the cursor for the next page (null at the end). `rows` must be in that order. */
export function pageAfter<T extends Pick<AgeingRow, "daysPastDue" | "flatCode" | "billId">>(rows: readonly T[], cursor: { d: number; f: string; b: string } | null, size = AGEING_PAGE_SIZE): { rows: T[]; nextCursor: string | null } {
  const after = cursor === null ? rows : rows.filter((r) => r.daysPastDue < cursor.d || (r.daysPastDue === cursor.d && (r.flatCode > cursor.f || (r.flatCode === cursor.f && r.billId > cursor.b))));
  const page = after.slice(0, size);
  const last = page.at(-1);
  return { rows: page, nextCursor: after.length > size && last !== undefined ? encodeCursor(last) : null };
}
