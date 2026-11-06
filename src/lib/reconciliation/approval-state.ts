import { t } from "@/lib/messages";
import { type SubmitErrorKind, reasonLength, reasonValid, resultLines } from "./review-state";
import type { EntryLine } from "./types";

export type ApprovalKind = "APPROVE" | "REJECT";
export type ApprovalErrorKind = SubmitErrorKind | "SELF_APPROVAL" | "STATE_CHANGED";

export type ApprovalResult =
  | { kind: "APPROVED_IGNORE" }
  | { kind: "APPROVED_MATCH"; flatCode: string; entries: EntryLine[]; feeOwedPaise: string | null; payerNotice: string | null }
  | { kind: "REJECTED" };

/** An approval note is optional, but when it is written it is 5 to 500 characters like every reason (an empty note is recorded as "Approved"). */
export const approvalNoteValid = (note: string): boolean => reasonLength(note) === 0 || reasonValid(note);
/** A rejection always needs a reason. */
export const rejectReasonValid = (reason: string): boolean => reasonValid(reason);

const text = (value: unknown): value is string => typeof value === "string";

/** Reads an answer of POST /api/bank-rows/<id>/approve or /reject. Anything unexpected is OTHER, never a guess. */
export function interpretApprovalResponse(kind: ApprovalKind, status: number, body: unknown): { ok: true; result: ApprovalResult } | { ok: false; error: ApprovalErrorKind } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 200) {
    if (kind === "REJECT" && b.status === "REJECTED") return { ok: true, result: { kind: "REJECTED" } };
    if (kind === "APPROVE" && b.status === "APPROVED" && b.action === "IGNORE") return { ok: true, result: { kind: "APPROVED_IGNORE" } };
    if (kind === "APPROVE" && b.status === "APPROVED" && b.action === "MATCH" && text(b.flatCode) && Array.isArray(b.entries)) {
      const remaining = (b.remaining ?? {}) as { feeOwedPaise?: unknown };
      return {
        ok: true,
        result: {
          kind: "APPROVED_MATCH",
          flatCode: b.flatCode,
          entries: (b.entries as EntryLine[]).map((e) => ({ entryType: e.entryType, amountPaise: e.amountPaise })),
          feeOwedPaise: text(remaining.feeOwedPaise) ? remaining.feeOwedPaise : null,
          payerNotice: text(b.payerNotice) ? b.payerNotice : null,
        },
      };
    }
    return { ok: false, error: "OTHER" };
  }
  const code = text(b.error) ? b.error : "";
  if (status === 409 && code === "SELF_APPROVAL") return { ok: false, error: "SELF_APPROVAL" };
  if (status === 409 && code === "STATE_CHANGED") return { ok: false, error: "STATE_CHANGED" };
  if (status === 409 && ["NOT_AWAITING_APPROVAL", "STALE", "NOT_QUEUED"].includes(code)) return { ok: false, error: "CHANGED" };
  if (status === 422 && code === "REASON_REQUIRED") return { ok: false, error: "REASON" };
  if (status === 403) return { ok: false, error: "FORBIDDEN" };
  return { ok: false, error: "OTHER" };
}

export function approvalErrorText(error: ApprovalErrorKind, submitText: (e: SubmitErrorKind) => string): string {
  switch (error) {
    case "SELF_APPROVAL":
      return t("recon.approval.selfApproval");
    case "STATE_CHANGED":
      return t("recon.approval.stateChanged");
    default:
      return submitText(error);
  }
}

/** The lines that say what an approval or a rejection did. */
export function approvalResultLines(result: ApprovalResult): string[] {
  switch (result.kind) {
    case "APPROVED_IGNORE":
      return [t("recon.approval.approvedIgnore")];
    case "REJECTED":
      return [t("recon.approval.rejected")];
    case "APPROVED_MATCH": {
      const [, ...entries] = resultLines({ kind: "POSTED", flatCode: result.flatCode, entries: result.entries, feeOwedPaise: result.feeOwedPaise, payerNotice: result.payerNotice });
      return [t("recon.approval.approvedMatch", { flat: result.flatCode }), ...entries];
    }
  }
}

