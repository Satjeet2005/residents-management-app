/**
 * The pure part of the developer's log reader (`npm run logs:errors`, D135): reads the command line, builds the one SELECT, and formats
 * rows. It touches no database and no process state, so a test can read it whole. Rows are redacted again before anything is printed.
 */
import { LOG_SOURCES, digestText, redact } from "./log";

export const SINCE_MS: Readonly<Record<string, number>> = { "30m": 30 * 60_000, "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000 };
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

export type Filters = { since: string; ref?: string; digest?: string; requestId?: string; route?: string; level?: "WARN" | "ERROR"; source?: string; limit: number };
export type Mode = "lines" | "json" | "paste";
export type ParsedArgs = { ok: true; filters: Filters; mode: Mode } | { ok: false; message: string };

const VALUE_OPTIONS = ["since", "ref", "digest", "request-id", "route", "level", "source", "limit"] as const;
const USAGE = `Usage: npm run logs:errors -- [--since=30m|1h|24h|7d] [--ref=E-XXXXXX] [--digest=N] [--request-id=ID] [--route=TEXT] [--level=warn|error] [--source=ROUTE|PAGE|ACTION|MIDDLEWARE|PROVIDER|JOB|AUDIT|TEST] [--limit=1..${MAX_LIMIT}] [--json | --paste]`;

/** Reads the arguments strictly: an unknown option, a repeated one, a missing value or a value out of range is refused with a plain sentence. */
export function parseLogsArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  let mode: Mode = "lines";
  for (const arg of argv) {
    if (arg === "--json" || arg === "--paste") {
      if (mode !== "lines") return { ok: false, message: `Use only one of --json and --paste. ${USAGE}` };
      mode = arg === "--json" ? "json" : "paste";
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    const name = match?.[1];
    if (match === null || !(VALUE_OPTIONS as readonly string[]).includes(name ?? "")) return { ok: false, message: `Unknown argument "${arg.split("=")[0]}". ${USAGE}` };
    if (values.has(match[1])) return { ok: false, message: `--${match[1]} was given twice.` };
    values.set(match[1], match[2]);
  }
  const since = values.get("since") ?? "24h";
  if (!(since in SINCE_MS)) return { ok: false, message: `--since must be one of 30m, 1h, 24h, 7d, not "${since}".` };
  const limitText = values.get("limit") ?? String(DEFAULT_LIMIT);
  const limit = /^[0-9]{1,4}$/.test(limitText) ? Number(limitText) : Number.NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) return { ok: false, message: `--limit must be a whole number from 1 to ${MAX_LIMIT}.` };
  const level = values.get("level")?.toUpperCase();
  if (level !== undefined && level !== "WARN" && level !== "ERROR") return { ok: false, message: "--level must be warn or error." };
  const source = values.get("source")?.toUpperCase();
  if (source !== undefined && !(LOG_SOURCES as readonly string[]).includes(source)) return { ok: false, message: `--source must be one of ${LOG_SOURCES.join(", ")}.` };
  return {
    ok: true,
    mode,
    filters: { since, limit, ref: values.get("ref"), digest: values.get("digest"), requestId: values.get("request-id"), route: values.get("route"), level, source },
  };
}

export type ErrorRow = {
  ref: string;
  occurred_at: Date;
  level: string;
  source: string;
  route: string;
  method: string | null;
  status: number | null;
  error_name: string;
  error_code: string | null;
  message: string;
  stack: string | null;
  deployment: string | null;
  digest: string | null;
  request_id: string | null;
  suppressed_count: number;
};

const COLUMNS = "ref, occurred_at, level, source, route, method, status, error_name, error_code, message, stack, deployment, digest, request_id, suppressed_count";

/** The SELECT and its parameters. Every filter is a bound parameter; the route is a plain "contains", not a pattern. */
export function buildQuery(filters: Filters, now: number): { text: string; values: unknown[] } {
  const where = ["occurred_at >= $1"];
  const values: unknown[] = [new Date(now - SINCE_MS[filters.since])];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    where.push(condition.replace("?", `$${values.length}`));
  };
  if (filters.ref !== undefined) add("ref = ?", filters.ref);
  if (filters.digest !== undefined) add("digest = ?", filters.digest);
  if (filters.requestId !== undefined) add("request_id = ?", filters.requestId);
  if (filters.route !== undefined) add("position(lower(?) in lower(route)) > 0", filters.route);
  if (filters.level !== undefined) add("level = ?", filters.level);
  if (filters.source !== undefined) add("source = ?", filters.source);
  values.push(filters.limit);
  return { text: `SELECT ${COLUMNS} FROM error_events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT $${values.length}`, values };
}

const safe = (text: string | null): string | null => (text === null ? null : redact(text));

/** The row with every text redacted again (the table is already redacted; this is the second lock). A digest is kept when it is plainly one. */
export function redactedRow(row: ErrorRow): ErrorRow {
  return {
    ...row,
    ref: redact(row.ref),
    route: redact(row.route),
    error_name: redact(row.error_name),
    message: redact(row.message),
    stack: safe(row.stack),
    method: safe(row.method),
    error_code: safe(row.error_code),
    deployment: safe(row.deployment),
    digest: row.digest === null ? null : digestText(row.digest),
    request_id: safe(row.request_id),
  };
}

/** One plain-text block for pasting to an assistant: the fields that explain the failure, and nothing else. */
export function formatPaste(row: ErrorRow): string {
  const r = redactedRow(row);
  const lines = [
    `ref: ${r.ref}`,
    `time: ${r.occurred_at.toISOString()}`,
    `level: ${r.level}`,
    `source: ${r.source}`,
    `route: ${r.route}`,
    `method: ${r.method ?? "-"}`,
    `status: ${r.status ?? "-"}`,
    `error name: ${r.error_name}`,
    `error code: ${r.error_code ?? "-"}`,
    `message: ${r.message}`,
    `stack:\n${r.stack ?? "-"}`,
    `deployment: ${r.deployment ?? "-"}`,
  ];
  if (r.digest !== null) lines.push(`digest: ${r.digest}`);
  if (r.suppressed_count > 0) lines.push(`suppressed before this: ${r.suppressed_count}`);
  return lines.join("\n");
}

/** One line: time, level, source, reference, status, route, message. */
export function formatLine(row: ErrorRow): string {
  const r = redactedRow(row);
  return `${r.occurred_at.toISOString()}  ${r.level.padEnd(5)}  ${r.source.padEnd(8)}  ${r.ref}  ${String(r.status ?? "-").padEnd(3)}  ${r.route}  ${r.error_name}: ${r.message}`;
}

export const NOTHING_FOUND = "No error events matched. Widen --since or drop a filter.";

/** What the command prints for the rows, in the chosen mode. */
export function render(rows: readonly ErrorRow[], mode: Mode): string {
  if (rows.length === 0) return mode === "json" ? "[]" : NOTHING_FOUND;
  if (mode === "json") return JSON.stringify(rows.map(redactedRow), null, 2);
  if (mode === "paste") return rows.map(formatPaste).join("\n\n---\n\n");
  return rows.map(formatLine).join("\n");
}

/** The one thing the reader needs from a database client; a `pg` Client fits it. */
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

/** Reads the matching rows inside a READ ONLY transaction, so even a mistake in this code could not write. */
export async function readErrorEvents(client: Queryable, filters: Filters, now: number): Promise<ErrorRow[]> {
  const { text, values } = buildQuery(filters, now);
  await client.query("BEGIN READ ONLY");
  try {
    return (await client.query(text, values)).rows as ErrorRow[];
  } finally {
    await client.query("COMMIT");
  }
}
