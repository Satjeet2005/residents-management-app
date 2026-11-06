import { z } from "zod";
import { type CalendarDate, istDateOf } from "@/domain/time/calendar";
import type { Db, DbOrTx } from "@/server/auth/db";
import { calendarDateOf } from "@/server/home/mapper";
import { getStatementSummary, type StatementSummary } from "./import";
import { type AmountRelation, type OpenPositionView, loadPolicy, loadPositions, openOnly, relationOf, viewOf } from "./positions";

/** The four lanes of the reconciliation screen, and the bank row states each one holds. */
export const LANES = ["NEEDS_YOU", "AWAITING_APPROVAL", "MATCHED", "NOT_MAINTENANCE"] as const;
export type Lane = (typeof LANES)[number];
const LANE_STATES: Record<Lane, readonly ("QUEUED" | "AUTO_MATCHED" | "AWAITING_APPROVAL" | "MANUALLY_MATCHED" | "IGNORED")[]> = {
  NEEDS_YOU: ["QUEUED"],
  AWAITING_APPROVAL: ["AWAITING_APPROVAL"],
  MATCHED: ["AUTO_MATCHED", "MANUALLY_MATCHED"],
  NOT_MAINTENANCE: ["IGNORED"],
};
export const MAX_PAGE = 50;

const storedDecision = z.object({
  kind: z.string(),
  confidence: z.string(),
  reasons: z.array(z.object({ code: z.string(), text: z.string() })),
  candidates: z.array(z.object({ flatCode: z.string(), score: z.number(), evidence: z.array(z.string()) })).max(5),
  totalCandidates: z.number(),
});

export type CandidateReview = {
  flatCode: string;
  tower: string;
  score: number;
  evidence: string[];
  residents: string[];
  /** The flat's open positions as of the row's transaction date, oldest due date first. FEE_ONLY ones are included. */
  openPositions: OpenPositionView[];
  amountRelation: AmountRelation;
};

export type RowReview = {
  id: string;
  importId: string;
  rowNumber: number;
  txnDate: CalendarDate;
  creditPaise: string;
  debitPaise: string;
  narrationRaw: string;
  parsed: unknown;
  state: string;
  version: number;
  flatCode: string | null;
  decision: { kind: string; confidence: string; reasons: { code: string; text: string }[]; totalCandidates: number } | null;
  candidates: CandidateReview[];
};

const currentMembers = (asOf: CalendarDate) => {
  const day = new Date(`${asOf}T00:00:00.000Z`);
  return { startsOn: { lte: day }, OR: [{ endsOn: null }, { endsOn: { gte: day } }] };
};

/** The names of the current residents of each flat, by flat id. Names only: no phone, no id. */
async function residentNames(db: DbOrTx, flatIds: readonly string[], today: CalendarDate): Promise<Map<string, string[]>> {
  const members = await db.flatMember.findMany({ where: { flatId: { in: [...flatIds] }, ...currentMembers(today) }, select: { flatId: true, user: { select: { name: true } } } });
  const byFlat = new Map<string, string[]>();
  for (const m of members) byFlat.set(m.flatId, [...(byFlat.get(m.flatId) ?? []), m.user.name]);
  for (const names of byFlat.values()) names.sort();
  return byFlat;
}

/**
 * Everything a person needs to decide one bank row (read only): the row as stored, the matcher's stored decision with its reasons
 * in plain English, and, for each of at most five candidate flats, its code, tower, current residents and open positions as of the
 * row's date with how the credit compares. A FEE_ONLY position is shown although the matcher does not see it (D107). Only the
 * candidates of THIS row are read: no other flat's data is returned. Null for an id that is not a row.
 */
export async function getRowReview({ db, rowId, now }: { db: DbOrTx; rowId: string; now: number }): Promise<RowReview | null> {
  if (!z.uuid().safeParse(rowId).success) return null;
  const row = await db.bankRow.findUnique({ where: { id: rowId }, include: { flat: { select: { code: true } } } });
  if (row === null) return null;
  const parsedJson = (row.parsed ?? {}) as { decision?: unknown };
  const decision = storedDecision.safeParse(parsedJson.decision);
  const stored = decision.success ? decision.data : null;
  const txnDate = calendarDateOf(row.txnDate);

  const flats = stored === null || stored.candidates.length === 0 ? [] : await db.flat.findMany({ where: { code: { in: stored.candidates.map((c) => c.flatCode) } }, select: { id: true, code: true, tower: true } });
  const policy = flats.length === 0 ? null : await loadPolicy(db);
  const positions = policy === null ? new Map() : await loadPositions(db, flats.map((f) => f.id), txnDate, policy);
  const names = await residentNames(db, flats.map((f) => f.id), istDateOf(now));
  const candidates: CandidateReview[] = [];
  for (const c of stored?.candidates ?? []) {
    const flat = flats.find((f) => f.code === c.flatCode);
    if (flat === undefined) continue;
    const open = openOnly(positions.get(flat.id) ?? []);
    candidates.push({
      flatCode: flat.code,
      tower: flat.tower,
      score: c.score,
      evidence: c.evidence,
      residents: names.get(flat.id) ?? [],
      openPositions: open.map(viewOf),
      amountRelation: relationOf(row.creditPaise, open[0]),
    });
  }
  return {
    id: row.id,
    importId: row.importId,
    rowNumber: row.rowNumber,
    txnDate,
    creditPaise: row.creditPaise.toString(),
    debitPaise: row.debitPaise.toString(),
    narrationRaw: row.narrationRaw,
    parsed: parsedJson === null ? null : { ...parsedJson, decision: undefined },
    state: row.state,
    version: row.version,
    flatCode: row.flat?.code ?? null,
    decision: stored === null ? null : { kind: stored.kind, confidence: stored.confidence, reasons: stored.reasons, totalCandidates: stored.totalCandidates },
    candidates,
  };
}

export type RowListItem = {
  id: string;
  rowNumber: number;
  txnDate: CalendarDate;
  amountPaise: string;
  direction: "CREDIT" | "DEBIT";
  narrationRaw: string;
  state: string;
  version: number;
  confidence: string | null;
  flatCode: string | null;
};

export type RowList = { items: RowListItem[]; nextCursor: string | null; laneCounts: Record<Lane, number>; summary: StatementSummary | null };

const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
/** The keyset cursor is `<amount>:<id>` in base64url: the last row of the page, so the next page starts after it. */
const encodeCursor = (amount: bigint, id: string): string => Buffer.from(`${amount}:${id}`, "utf8").toString("base64url");
function decodeCursor(cursor: string | undefined): { amount: bigint; id: string } | null {
  if (cursor === undefined || !cursorSchema.safeParse(cursor).success) return null;
  const match = /^([0-9]{1,18}):([0-9a-f-]{36})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match === null ? null : { amount: BigInt(match[1]), id: match[2] };
}

/**
 * The rows of one import in one lane, biggest amount first, then by id, a page at a time (keyset, so a page never skips or repeats a
 * row while others change state). `limit` is at most 50. Also the row counts of all four lanes and the import's summary.
 * Null for an id that is not an import. A bad cursor starts from the first page.
 */
export async function listRows({ db, importId, lane, cursor, limit }: { db: Db; importId: string; lane: Lane; cursor?: string; limit?: number }): Promise<RowList | null> {
  if (!z.uuid().safeParse(importId).success) return null;
  const summary = await getStatementSummary(db, importId);
  if (summary === null) return null;
  const size = Math.min(Math.max(Math.trunc(limit ?? 25), 1), MAX_PAGE);
  const after = decodeCursor(cursor);
  const states = [...LANE_STATES[lane]];
  const rows = await db.$queryRaw<
    { id: string; row_number: number; txn_date: Date; amount: bigint; credit: bigint; narration_raw: string; state: string; version: number; parsed: { decision?: { confidence?: string } } | null; flat_code: string | null }[]
  >`SELECT b.id::text AS id, b.row_number, b.txn_date, GREATEST(b.credit_paise, b.debit_paise) AS amount, b.credit_paise AS credit, b.narration_raw, b.state::text AS state, b.version, b.parsed, f.code AS flat_code
    FROM bank_rows b LEFT JOIN flats f ON f.id = b.flat_id
    WHERE b.import_id = ${importId}::uuid AND b.state::text = ANY(${states})
      AND (${after === null} OR GREATEST(b.credit_paise, b.debit_paise) < ${after?.amount ?? 0n} OR (GREATEST(b.credit_paise, b.debit_paise) = ${after?.amount ?? 0n} AND b.id::text > ${after?.id ?? ""}))
    ORDER BY amount DESC, b.id ASC
    LIMIT ${size + 1}`;
  const page = rows.slice(0, size);
  const grouped = await db.bankRow.groupBy({ by: ["state"], where: { importId }, _count: { _all: true } });
  const count = (names: readonly string[]): number => grouped.filter((g) => names.includes(g.state)).reduce((sum, g) => sum + g._count._all, 0);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      rowNumber: r.row_number,
      txnDate: calendarDateOf(r.txn_date),
      amountPaise: r.amount.toString(),
      direction: r.credit > 0n ? "CREDIT" : "DEBIT",
      narrationRaw: r.narration_raw,
      state: r.state,
      version: r.version,
      confidence: r.parsed?.decision?.confidence ?? null,
      flatCode: r.flat_code,
    })),
    nextCursor: rows.length > size && last !== undefined ? encodeCursor(BigInt(last.amount), last.id) : null,
    laneCounts: Object.fromEntries(LANES.map((l) => [l, count(LANE_STATES[l])])) as Record<Lane, number>,
    summary,
  };
}

export type ImportListItem = { importId: string; filename: string; uploadedAt: string; rowsRead: number };

/** The latest imports, newest first (at most `limit`, default 10). */
export async function listImports({ db, limit }: { db: Db; limit?: number }): Promise<ImportListItem[]> {
  const rows = await db.statementImport.findMany({ orderBy: [{ uploadedAt: "desc" }, { id: "asc" }], take: Math.min(Math.max(Math.trunc(limit ?? 10), 1), 10), select: { id: true, filename: true, uploadedAt: true, rowsRead: true } });
  return rows.map((r) => ({ importId: r.id, filename: r.filename, uploadedAt: r.uploadedAt.toISOString(), rowsRead: r.rowsRead }));
}

export type FlatSearchHit = { flatCode: string; tower: string; residents: string[]; openPositions: number };

const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Finds flats for a person who is matching a row by hand. `q` is at least 2 characters after trimming. A flat code PREFIX works with
 * or without the separators the flat-code reader accepts ("t12 04", "T12-04", "t12/0408" are the same prefix), and a resident name
 * token matches the start of any word of a current resident's name. At most 10 flats, with code, tower, current residents' names
 * and the number of open positions today. No phone, no id.
 */
export async function searchFlats({ db, q, now }: { db: Db; q: string; now: number }): Promise<FlatSearchHit[]> {
  const text = q.trim();
  if (Array.from(text).length < 2 || text.length > 60) return [];
  const today = istDateOf(now);
  const compact = text.toUpperCase().replace(/[\s\-_./,:]+/g, "");
  const byCode = /^[A-Z0-9]{2,}$/.test(compact)
    ? await db.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM flats WHERE REPLACE(UPPER(code), '-', '') LIKE ${`${likeEscape(compact)}%`} ORDER BY code LIMIT 10`
    : [];
  const token = likeEscape(text.replace(/\s+/g, " "));
  const byName = await db.$queryRaw<{ flat_id: string }[]>`SELECT DISTINCT fm.flat_id::text AS flat_id, f.code
    FROM flat_members fm JOIN users u ON u.id = fm.user_id JOIN flats f ON f.id = fm.flat_id
    WHERE fm.starts_on <= ${new Date(`${today}T00:00:00.000Z`)}::date AND (fm.ends_on IS NULL OR fm.ends_on >= ${new Date(`${today}T00:00:00.000Z`)}::date)
      AND (u.name ILIKE ${`${token}%`} OR u.name ILIKE ${`% ${token}%`})
    ORDER BY f.code LIMIT 10`;
  const ids = [...new Set([...byCode.map((r) => r.id), ...byName.map((r) => r.flat_id)])].slice(0, 10);
  if (ids.length === 0) return [];
  const [flats, names, positions] = await Promise.all([
    db.flat.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, tower: true }, orderBy: { code: "asc" } }),
    residentNames(db, ids, today),
    loadPolicy(db).then((policy) => loadPositions(db, ids, today, policy)),
  ]);
  return flats.map((f) => ({ flatCode: f.code, tower: f.tower, residents: names.get(f.id) ?? [], openPositions: openOnly(positions.get(f.id) ?? []).length }));
}
