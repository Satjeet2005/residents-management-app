import { CATEGORY_CODES, type CategoryCode, isCategoryCode } from "@/domain/complaints/taxonomy";
import type { PanelError } from "./panel";

/** How long "Undo" stays after a category was changed (D239). */
export const UNDO_MS = 6000;

export type ChipsState = {
  /** The category shown as pressed (what the last answer of the server said). */
  category: string | null;
  /** The version the next call is sent with: the one the page was shown with, then the one each answer returns. */
  version: number;
  pending: boolean;
  /** The last thing worth saying: a change (the category now), or a refusal. */
  message: { kind: "CHANGED"; category: CategoryCode } | { kind: "ERROR"; error: PanelError } | null;
  /** The category before the last change, while the window is open; null when there was none to go back to or the window is over. */
  undo: { previous: CategoryCode; until: number } | null;
};

export type ChipsEvent =
  | { type: "STARTED" }
  | { type: "CHANGED"; to: CategoryCode; from: string | null; version: number; at: number; undoable: boolean }
  | { type: "FAILED"; error: PanelError }
  | { type: "EXPIRED"; at: number }
  | { type: "PAGE_CHANGED"; category: string | null; version: number };

export const initialChips = (category: string | null, version: number): ChipsState => ({ category, version, pending: false, message: null, undo: null });

export function chipsReducer(state: ChipsState, event: ChipsEvent): ChipsState {
  switch (event.type) {
    case "STARTED":
      return state.pending ? state : { ...state, pending: true, message: null };
    case "CHANGED": {
      const previous = event.from !== null && isCategoryCode(event.from) ? event.from : null;
      return { category: event.to, version: event.version, pending: false, message: { kind: "CHANGED", category: event.to }, undo: event.undoable && previous !== null ? { previous, until: event.at + UNDO_MS } : null };
    }
    case "FAILED":
      return { ...state, pending: false, message: { kind: "ERROR", error: event.error }, undo: null };
    case "EXPIRED":
      return state.undo !== null && event.at >= state.undo.until ? { ...state, undo: null } : state;
    case "PAGE_CHANGED":
      return event.version > state.version && !state.pending ? { ...state, category: event.category, version: event.version, message: null, undo: null } : state;
  }
}

/** What a chip is: pressed when it is the complaint's category; disabled (not tappable) for a closed complaint or while a change is in flight. */
export const chipState = (input: { code: CategoryCode; current: string | null; closed: boolean; pending: boolean }): { pressed: boolean; disabled: boolean } => ({
  pressed: input.code === input.current,
  disabled: input.closed || input.pending,
});

/** Does a tap on this chip send a change? Not for the pressed chip, a closed complaint or while another change is in flight. */
export const tapSends = (input: { code: CategoryCode; current: string | null; closed: boolean; pending: boolean }): boolean => !input.closed && !input.pending && input.code !== input.current;

/** The five chips, in the order of the taxonomy. */
export const CHIP_CODES: readonly CategoryCode[] = CATEGORY_CODES;
