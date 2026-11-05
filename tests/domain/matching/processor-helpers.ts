import { parseStatementCsv, type RowError, type StatementRow } from "@/domain/matching/csv";
import type { ProcessInput } from "@/domain/matching/processor";
import { defaultMatchSettings } from "@/domain/matching/context";
import type { FlatContext } from "@/domain/matching/types";

/** Statement rows from CSV lines `date,narration,credit,debit` (with a header added). */
export function readCsv(lines: string[]): { rows: StatementRow[]; errors: RowError[] } {
  const result = parseStatementCsv(["date,narration,credit,debit", ...lines].join("\n") + "\n");
  return { rows: result.rows, errors: result.errors };
}

export function inputOf(flats: FlatContext[], lines: string[], alreadyImportedKeys: ReadonlySet<string> = new Set()): ProcessInput {
  const { rows, errors } = readCsv(lines);
  return { rows, csvErrors: errors, flats, settings: defaultMatchSettings, alreadyImportedKeys };
}
