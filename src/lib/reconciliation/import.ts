import { t } from "@/lib/messages";

/** The most characters a statement may have: the same limit the server enforces (413), checked first so a big file is never sent. */
export const MAX_FILE_CHARS = 2_000_000;
export const MAX_ERRORS_SHOWN = 5;

/** "812 bytes", "340.5 KB", "1.2 MB": no Intl, the same text on every machine. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("A file size is a number of bytes, not negative");
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileCheck = { ok: true } | { ok: false; message: string };

/** The text of a chosen file is refused before sending when it is empty or over 2,000,000 characters. */
export function checkFileText(text: string): FileCheck {
  if (text.trim() === "") return { ok: false, message: t("recon.upload.empty") };
  if (text.length > MAX_FILE_CHARS) return { ok: false, message: t("recon.upload.tooLarge") };
  return { ok: true };
}

export type ImportSummaryView = { rowsRead: number; autoMatched: number; queued: number; ignored: number; alreadyImported: number; invalidRows: number };

export type ImportOutcome =
  | { kind: "IMPORTED"; importId: string; summary: ImportSummaryView }
  | { kind: "INVALID_CSV"; errors: { rowNumber: number; message: string }[] }
  | { kind: "TOO_LARGE" }
  | { kind: "IN_PROGRESS" }
  | { kind: "FORBIDDEN" }
  | { kind: "FAILED" };

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/** Reads an answer of POST /api/statements (or /sample). An answer that is not what was expected is FAILED, never a guess. */
export function interpretImportResponse(status: number, body: unknown): ImportOutcome {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 200 && typeof b.importId === "string" && b.accounted === true) {
    const s = (b.summary ?? {}) as Record<string, unknown>;
    if ([s.rowsRead, s.autoMatched, s.queued, s.ignored, s.alreadyImported, s.invalidRows].every(isNumber)) {
      return {
        kind: "IMPORTED",
        importId: b.importId,
        summary: { rowsRead: s.rowsRead as number, autoMatched: s.autoMatched as number, queued: s.queued as number, ignored: s.ignored as number, alreadyImported: s.alreadyImported as number, invalidRows: s.invalidRows as number },
      };
    }
  }
  if (status === 422 && b.error === "INVALID_CSV" && Array.isArray(b.errors)) {
    return { kind: "INVALID_CSV", errors: (b.errors as { rowNumber?: unknown; message?: unknown }[]).map((e) => ({ rowNumber: isNumber(e.rowNumber) ? e.rowNumber : 0, message: typeof e.message === "string" ? e.message : "" })) };
  }
  if (status === 413) return { kind: "TOO_LARGE" };
  if (status === 409 && b.error === "IMPORT_IN_PROGRESS") return { kind: "IN_PROGRESS" };
  if (status === 403) return { kind: "FORBIDDEN" };
  return { kind: "FAILED" };
}

/** The lines for a refused file: the first 5 problems, then how many there were in all. */
export function invalidCsvLines(errors: readonly { rowNumber: number; message: string }[]): string[] {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN).map((e) => (e.rowNumber === 0 ? e.message : t("recon.upload.invalid.row", { row: e.rowNumber, message: e.message })));
  const count = errors.length === 1 ? t("recon.upload.invalid.one") : t("recon.upload.invalid.many", { count: errors.length });
  return [...shown, count];
}

/** The sentence for an outcome that is not a success. */
export function failureText(outcome: Exclude<ImportOutcome, { kind: "IMPORTED" } | { kind: "INVALID_CSV" }> | { kind: "NETWORK" }): string {
  switch (outcome.kind) {
    case "TOO_LARGE":
      return t("recon.upload.http413");
    case "IN_PROGRESS":
      return t("recon.upload.inProgress");
    case "FORBIDDEN":
      return t("recon.upload.forbidden");
    case "NETWORK":
      return t("recon.upload.network");
    case "FAILED":
      return t("recon.upload.error");
  }
}

export function importedText(filename: string, summary: ImportSummaryView): string {
  return t("recon.upload.done", { file: filename, rows: summary.rowsRead, auto: summary.autoMatched, queued: summary.queued, ignored: summary.ignored, already: summary.alreadyImported });
}
