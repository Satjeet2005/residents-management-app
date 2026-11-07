import { REASON_MAX, isValidReason } from "@/domain/complaints/lifecycle";

/**
 * The resident's answer to "Is it fixed?" as a pure state machine (D15). "Yes, it's fixed" leads to an optional rating and then Done;
 * "No, still a problem" leads to a required reason of 5 to 500 characters. A second tap while sending does nothing.
 */
export type ActionMode = "ASK" | "RATE" | "REASON";
export type ActionError = "STALE" | "VALIDATION" | "NOT_FOUND" | "NETWORK" | "SERVER";
export type ActionDone = "CONFIRMED" | "REOPENED";

export type ActionState = {
  mode: ActionMode;
  /** 1 to 5, or null when the person skips the rating. */
  rating: number | null;
  reason: string;
  busy: boolean;
  /** True after a submit with a reason that is too short or too long, so the page shows the inline error. */
  reasonInvalid: boolean;
  error: ActionError | null;
  done: ActionDone | null;
};

export const initialActionState: ActionState = { mode: "ASK", rating: null, reason: "", busy: false, reasonInvalid: false, error: null, done: null };

export type ActionAction =
  | { type: "CHOOSE_FIXED" }
  | { type: "CHOOSE_PROBLEM" }
  | { type: "BACK" }
  | { type: "RATING_CHOSEN"; value: number }
  | { type: "REASON_CHANGED"; value: string }
  | { type: "SUBMIT" }
  | { type: "SUCCEEDED"; done: ActionDone }
  | { type: "FAILED"; error: ActionError };

export const reasonCount = (reason: string): number => Array.from(reason).length;
export const isReasonValid = (reason: string): boolean => isValidReason(reason);

export function actionReducer(state: ActionState, action: ActionAction): ActionState {
  if (state.busy && action.type !== "SUCCEEDED" && action.type !== "FAILED") return state;
  switch (action.type) {
    case "CHOOSE_FIXED":
      return { ...state, mode: "RATE", error: null };
    case "CHOOSE_PROBLEM":
      return { ...state, mode: "REASON", error: null };
    case "BACK":
      return { ...initialActionState, reason: state.reason };
    case "RATING_CHOSEN":
      return Number.isInteger(action.value) && action.value >= 1 && action.value <= 5 ? { ...state, rating: state.rating === action.value ? null : action.value } : state;
    case "REASON_CHANGED":
      return { ...state, reason: Array.from(action.value).slice(0, REASON_MAX).join(""), reasonInvalid: false, error: null };
    case "SUBMIT":
      if (state.mode === "ASK") return state;
      if (state.mode === "REASON" && !isReasonValid(state.reason)) return { ...state, reasonInvalid: true };
      return { ...state, busy: true, error: null };
    case "SUCCEEDED":
      return { ...state, busy: false, done: action.done };
    case "FAILED":
      return { ...state, busy: false, error: action.error };
  }
}

/** The body of POST /api/complaints/[id]/confirm: the rating only when one was chosen. */
export const confirmBodyOf = (state: Pick<ActionState, "rating">): { rating?: number } => (state.rating === null ? {} : { rating: state.rating });

export type ActionOutcome = { kind: "OK" } | { kind: "ERROR"; error: ActionError };

/** Reads the answer of /confirm or /reopen. 409 (STALE or INVALID_TRANSITION) means the complaint changed: the page asks for a reload. */
export function classifyAction(status: number): ActionOutcome {
  if (status === 200) return { kind: "OK" };
  if (status === 409) return { kind: "ERROR", error: "STALE" };
  if (status === 422) return { kind: "ERROR", error: "VALIDATION" };
  if (status === 404) return { kind: "ERROR", error: "NOT_FOUND" };
  return { kind: "ERROR", error: "SERVER" };
}
