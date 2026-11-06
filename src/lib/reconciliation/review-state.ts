import { formatRupees } from "@/domain/money/money";
import { t } from "@/lib/messages";
import type { EntryLine, FlatHit } from "./types";

export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const SEARCH_MIN = 2;

export type SubmitKind = "MATCH" | "IGNORE";
export type SubmitErrorKind = "CHANGED" | "NEEDS_ADVANCE" | "NO_OPEN_BILL" | "REASON" | "FLAT_NOT_FOUND" | "NETWORK" | "FORBIDDEN" | "OTHER";

/** What a successful manual action answered, as the screen shows it. */
export type SubmitResult =
  | { kind: "POSTED"; flatCode: string; entries: EntryLine[]; feeOwedPaise: string | null; payerNotice: string | null }
  | { kind: "AWAITING_APPROVAL"; thresholdPaise: string }
  | { kind: "IGNORED" };

export type SearchState = { status: "IDLE" | "LOADING" | "DONE" | "ERROR"; hits: FlatHit[] };

export type ReviewState = {
  /** The chosen flat: one of the candidates or a search hit. */
  flatCode: string | null;
  query: string;
  search: SearchState;
  reason: string;
  remember: boolean;
  /** Set when "Not a maintenance payment" was pressed without a valid reason, so the field can say what is missing. */
  reasonAsked: boolean;
  submit: { status: "IDLE" | "SUBMITTING" | "DONE" | "ERROR"; kind: SubmitKind | null; error: SubmitErrorKind | null; result: SubmitResult | null };
};

export type ReviewAction =
  | { type: "SELECT_FLAT"; flatCode: string }
  | { type: "SET_QUERY"; query: string }
  | { type: "SEARCH_START" }
  | { type: "SEARCH_DONE"; hits: FlatHit[] }
  | { type: "SEARCH_FAILED" }
  | { type: "SET_REASON"; reason: string }
  | { type: "SET_REMEMBER"; remember: boolean }
  | { type: "ASK_REASON" }
  | { type: "SUBMIT_START"; kind: SubmitKind }
  | { type: "SUBMIT_DONE"; result: SubmitResult }
  | { type: "SUBMIT_FAILED"; error: SubmitErrorKind }
  | { type: "RESET" };

/** The state for a row with `firstCandidate` (the best one) already chosen, or none. */
export const initialReviewState = (firstCandidate: string | null): ReviewState => ({
  flatCode: firstCandidate,
  query: "",
  search: { status: "IDLE", hits: [] },
  reason: "",
  remember: false,
  reasonAsked: false,
  submit: { status: "IDLE", kind: null, error: null, result: null },
});

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SELECT_FLAT":
      return { ...state, flatCode: action.flatCode };
    case "SET_QUERY":
      return { ...state, query: action.query, search: searchReady(action.query) ? state.search : { status: "IDLE", hits: [] } };
    case "SEARCH_START":
      return { ...state, search: { status: "LOADING", hits: [] } };
    case "SEARCH_DONE":
      return { ...state, search: { status: "DONE", hits: action.hits } };
    case "SEARCH_FAILED":
      return { ...state, search: { status: "ERROR", hits: [] } };
    case "SET_REASON":
      return { ...state, reason: action.reason.slice(0, REASON_MAX * 2), reasonAsked: false };
    case "SET_REMEMBER":
      return { ...state, remember: action.remember };
    case "ASK_REASON":
      return { ...state, reasonAsked: true };
    case "SUBMIT_START":
      return state.submit.status === "SUBMITTING" ? state : { ...state, submit: { status: "SUBMITTING", kind: action.kind, error: null, result: null } };
    case "SUBMIT_DONE":
      return { ...state, submit: { status: "DONE", kind: state.submit.kind, error: null, result: action.result } };
    case "SUBMIT_FAILED":
      return { ...state, submit: { status: "ERROR", kind: state.submit.kind, error: action.error, result: null } };
    case "RESET":
      return initialReviewState(null);
  }
}

export const searchReady = (query: string): boolean => Array.from(query.trim()).length >= SEARCH_MIN;
export const reasonLength = (reason: string): number => Array.from(reason.trim()).length;
export const reasonValid = (reason: string): boolean => reasonLength(reason) >= REASON_MIN && reasonLength(reason) <= REASON_MAX;
export const reasonCounter = (reason: string): string => t("recon.reason.counter", { n: reasonLength(reason), max: REASON_MAX });

/** The primary action is available only with a flat, a valid reason and no submit in flight. */
export const canPost = (state: ReviewState): boolean => state.flatCode !== null && reasonValid(state.reason) && state.submit.status !== "SUBMITTING";
/** "Not a maintenance payment" needs no flat; pressing it without a valid reason asks for one instead of sending. */
export const canIgnore = (state: ReviewState): boolean => state.submit.status !== "SUBMITTING";
export const postLabel = (flatCode: string | null): string => (flatCode === null ? t("recon.post.none") : t("recon.post", { flat: flatCode }));

/** The credit is at or above the threshold, so a post is only requested and waits for a second approver. */
export const needsSecondApprover = (creditPaise: bigint, thresholdPaise: bigint): boolean => creditPaise >= thresholdPaise;

const text = (value: unknown): value is string => typeof value === "string";

/** Reads an answer of POST /api/bank-rows/<id>/match or /ignore. Anything unexpected is OTHER, never a guess. */
export function interpretManualResponse(kind: SubmitKind, status: number, body: unknown): { ok: true; result: SubmitResult } | { ok: false; error: SubmitErrorKind } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 200) {
    if (b.status === "AWAITING_APPROVAL" && text(b.thresholdPaise)) return { ok: true, result: { kind: "AWAITING_APPROVAL", thresholdPaise: b.thresholdPaise } };
    if (kind === "IGNORE" && b.status === "IGNORED") return { ok: true, result: { kind: "IGNORED" } };
    if (kind === "MATCH" && b.status === "POSTED" && text(b.flatCode) && Array.isArray(b.entries)) {
      const remaining = (b.remaining ?? {}) as { feeOwedPaise?: unknown };
      return {
        ok: true,
        result: {
          kind: "POSTED",
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
  if (status === 409 && ["STALE", "STATE_CHANGED", "NOT_QUEUED", "NOT_AWAITING_APPROVAL"].includes(code)) return { ok: false, error: "CHANGED" };
  if (status === 422 && code === "NEEDS_ADVANCE_HANDLING") return { ok: false, error: "NEEDS_ADVANCE" };
  if (status === 422 && code === "NO_OPEN_BILL") return { ok: false, error: "NO_OPEN_BILL" };
  if (status === 422 && code === "REASON_REQUIRED") return { ok: false, error: "REASON" };
  if (status === 422 && code === "FLAT_NOT_FOUND") return { ok: false, error: "FLAT_NOT_FOUND" };
  if (status === 403) return { ok: false, error: "FORBIDDEN" };
  return { ok: false, error: "OTHER" };
}

/** The sentence for a refused or failed action. */
export function submitErrorText(error: SubmitErrorKind): string {
  switch (error) {
    case "CHANGED":
      return t("recon.error.changed");
    case "NEEDS_ADVANCE":
      return t("recon.error.needsAdvance");
    case "NO_OPEN_BILL":
      return t("recon.error.noOpenBill");
    case "REASON":
      return t("recon.error.reason");
    case "FLAT_NOT_FOUND":
      return t("recon.error.flatNotFound");
    case "NETWORK":
      return t("recon.error.network");
    case "FORBIDDEN":
      return t("recon.error.forbidden");
    case "OTHER":
      return t("recon.error.other");
  }
}

/** The lines that say what a successful action did: each entry's type and amount, the late fee still due, or what is waiting. */
export function resultLines(result: SubmitResult): string[] {
  switch (result.kind) {
    case "POSTED": {
      const lines = [t("recon.result.posted", { flat: result.flatCode })];
      for (const entry of result.entries) {
        const amount = formatRupees(BigInt(entry.amountPaise));
        lines.push(entry.entryType === "LATE_FEE" ? t("recon.entry.lateFee", { amount }) : entry.entryType === "PAYMENT" ? t("recon.entry.payment", { amount }) : t("recon.entry.other", { amount }));
      }
      if (result.feeOwedPaise !== null) lines.push(t("recon.result.feeStillDue", { amount: formatRupees(BigInt(result.feeOwedPaise)) }));
      return lines;
    }
    case "AWAITING_APPROVAL":
      return [t("recon.result.awaiting", { amount: formatRupees(BigInt(result.thresholdPaise)) })];
    case "IGNORED":
      return [t("recon.result.ignored")];
  }
}
