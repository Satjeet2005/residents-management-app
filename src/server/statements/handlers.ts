import { z } from "zod";
import type { RowError } from "@/domain/matching/csv";
import type { GuardContext } from "@/server/auth/guard";
import { businessNow } from "@/server/clock";
import { getStatementSummary, importStatement, StatementLimitError } from "./import";

/** A statement file may be 2,000,000 characters; the JSON around it adds a little (escapes), so this is the most a body may be. */
const MAX_BODY_CHARS = 2_600_000;

export const importBody = z.object({ filename: z.string().min(1).max(200), csv: z.string() });
const idSchema = z.uuid();

const json = (status: number, body: unknown): Response => Response.json(body, { status });
const fileError = (message: string): RowError[] => [{ rowNumber: 0, column: "file", message }];

type Env = Readonly<Record<string, string | undefined>>;

/**
 * POST /api/statements (the route wraps this in withPermission("payments:match")). Answers
 * - 200 `{ importId, summary, accounted: true, csvErrors }` (paise as decimal strings),
 * - 422 `{ error: "INVALID_CSV", errors }` for a bad header or a NUL byte, with the first 50 errors; nothing is stored,
 * - 413 `{ error: "TOO_LARGE" }` for a file over 2,000,000 characters or 20,000 rows,
 * - 409 `{ error: "IMPORT_IN_PROGRESS" }` when another import held the lock for 5 s,
 * - 400 `{ error: "INVALID_REQUEST" }` for a body that is not `{ filename, csv }`.
 * `now` is the business clock (D97): it decides which bills are open; tests pass their own.
 */
export async function handleImport(context: Pick<GuardContext, "user" | "deps" | "request">, options: { env?: Env; now?: number } = {}): Promise<Response> {
  const text = await context.request.text();
  if (text.length > MAX_BODY_CHARS) return json(413, { error: "TOO_LARGE" });
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const body = importBody.safeParse(value);
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });
  try {
    const result = await importStatement({ db: context.deps.db, user: context.user, filename: body.data.filename, csvText: body.data.csv, now: options.now ?? businessNow(options.env ?? process.env) });
    switch (result.status) {
      case "IMPORTED":
        return json(200, { importId: result.importId, summary: result.summary, accounted: result.accounted, csvErrors: result.csvErrors });
      case "INVALID_CSV":
        return json(422, { error: "INVALID_CSV", errors: result.errors });
      case "IMPORT_IN_PROGRESS":
        return json(409, { error: "IMPORT_IN_PROGRESS" });
    }
  } catch (error) {
    if (!(error instanceof StatementLimitError)) throw error;
    return error.code === "NUL_BYTES" ? json(422, { error: "INVALID_CSV", errors: fileError(error.message) }) : json(413, { error: "TOO_LARGE" });
  }
}

/** GET /api/statements/[id]: the counts of one import, read from the database; 404 for an id that is not an import. */
export async function handleSummary(context: Pick<GuardContext, "deps" | "request">): Promise<Response> {
  const id = idSchema.safeParse(new URL(context.request.url).pathname.split("/").filter(Boolean).at(-1));
  if (!id.success) return json(404, { error: "NOT_FOUND" });
  const summary = await getStatementSummary(context.deps.db, id.data);
  return summary === null ? json(404, { error: "NOT_FOUND" }) : json(200, summary);
}
