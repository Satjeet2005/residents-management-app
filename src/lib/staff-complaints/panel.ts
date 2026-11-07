import { CATEGORY_CODES } from "@/domain/complaints/taxonomy";

/**
 * The action panel of one complaint as a pure state machine (D130). Seven actions: assign, mark in progress (START), mark resolved (RESOLVE, with a note),
 * comment, correct the category, and for the duty manager acknowledge and close (with a note). Only ONE action is in flight at a time, so a second tap on
 * any control does nothing until the first answers. The state holds no sentence: the view turns an action, a subject and an error into words.
 */
export type PanelAction = "ASSIGN" | "START" | "RESOLVE" | "COMMENT" | "CATEGORY" | "ACKNOWLEDGE" | "CLOSE";
export type PanelError = "STALE" | "FORBIDDEN" | "NOT_FOUND" | "ASSIGNEE_INVALID" | "VALIDATION" | "NETWORK" | "SERVER";
export type NoteForm = "RESOLVE" | "CLOSE";
export type TextField = "assigneeId" | "commentText" | "category" | "resolveNote" | "closeNote";

export const COMMENT_MAX = 1000;
export const NOTE_MIN = 5;
export const NOTE_MAX = 500;

export type PanelState = {
  assigneeId: string;
  commentText: string;
  /** "Visible to the resident": OFF until the person ticks it (D130). */
  commentVisible: boolean;
  category: string;
  /** The note form that is open ("Mark resolved" and "Close this safety complaint" each ask for a note first). */
  noteOpen: NoteForm | null;
  resolveNote: string;
  closeNote: string;
  /** The action whose form was submitted with something missing: its inline error shows. */
  invalid: PanelAction | null;
  pending: PanelAction | null;
  error: { action: PanelAction; error: PanelError } | null;
  /** The last action that worked, with the one fact it changed (a name or a category), for the confirmation line. */
  done: { action: PanelAction; subject: string | null } | null;
};

export const initialPanelState: PanelState = {
  assigneeId: "",
  commentText: "",
  commentVisible: false,
  category: "",
  noteOpen: null,
  resolveNote: "",
  closeNote: "",
  invalid: null,
  pending: null,
  error: null,
  done: null,
};

export type PanelEvent =
  | { type: "FIELD"; field: TextField; value: string }
  | { type: "VISIBLE_TOGGLED" }
  | { type: "NOTE_OPENED"; form: NoteForm }
  | { type: "NOTE_CLOSED" }
  | { type: "SUBMIT"; action: PanelAction }
  | { type: "SUCCEEDED"; subject: string | null }
  | { type: "FAILED"; error: PanelError };

export const countChars = (text: string): number => Array.from(text).length;
const clamp = (text: string, max: number): string => (countChars(text) <= max ? text : Array.from(text).slice(0, max).join(""));
const noteOk = (text: string): boolean => {
  const length = countChars(text.trim());
  return length >= NOTE_MIN && length <= NOTE_MAX;
};

/** Is the form of this action complete? START and ACKNOWLEDGE have no form. */
export function isComplete(state: PanelState, action: PanelAction): boolean {
  switch (action) {
    case "ASSIGN":
      return state.assigneeId !== "";
    case "COMMENT": {
      const length = countChars(state.commentText.trim());
      return length >= 1 && length <= COMMENT_MAX;
    }
    case "CATEGORY":
      return (CATEGORY_CODES as readonly string[]).includes(state.category);
    case "RESOLVE":
      return noteOk(state.resolveNote);
    case "CLOSE":
      return noteOk(state.closeNote);
    case "START":
    case "ACKNOWLEDGE":
      return true;
  }
}

/** Saving the same category again is pointless (the service refuses it); the view uses this to switch Save off. A complaint that waits for review may take its own category. */
export const categoryUnchanged = (chosen: string, current: string | null, needsReview: boolean): boolean => chosen === current && !needsReview;

const FIELD_MAX: Record<TextField, number> = { assigneeId: 64, commentText: COMMENT_MAX, category: 32, resolveNote: NOTE_MAX, closeNote: NOTE_MAX };

export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  if (state.pending !== null && event.type !== "SUCCEEDED" && event.type !== "FAILED") return state;
  switch (event.type) {
    case "FIELD":
      return { ...state, [event.field]: clamp(event.value, FIELD_MAX[event.field]), invalid: null, error: null };
    case "VISIBLE_TOGGLED":
      return { ...state, commentVisible: !state.commentVisible, error: null };
    case "NOTE_OPENED":
      return { ...state, noteOpen: event.form, invalid: null, error: null, done: null };
    case "NOTE_CLOSED":
      return { ...state, noteOpen: null, invalid: null };
    case "SUBMIT":
      if (!isComplete(state, event.action)) return { ...state, invalid: event.action };
      return { ...state, pending: event.action, invalid: null, error: null, done: null };
    case "SUCCEEDED": {
      if (state.pending === null) return state;
      const action = state.pending;
      const cleared: Partial<PanelState> =
        action === "ASSIGN" ? { assigneeId: "" }
        : action === "COMMENT" ? { commentText: "", commentVisible: false }
        : action === "CATEGORY" ? { category: "" }
        : action === "RESOLVE" ? { resolveNote: "", noteOpen: null }
        : action === "CLOSE" ? { closeNote: "", noteOpen: null }
        : {};
      return { ...state, ...cleared, pending: null, error: null, done: { action, subject: event.subject } };
    }
    case "FAILED":
      return state.pending === null ? state : { ...state, pending: null, error: { action: state.pending, error: event.error } };
  }
}

/** The route and body of an action. Every action that changes the complaint sends the version it was shown with, so a complaint someone else changed is refused (409). */
export type PanelRequest = { path: string; body: Record<string, unknown> };

export function requestOf(action: PanelAction, state: PanelState, version: number): PanelRequest {
  switch (action) {
    case "ASSIGN":
      return { path: "assign", body: { assigneeUserId: state.assigneeId, expectedVersion: version } };
    case "START":
      return { path: "status", body: { status: "IN_PROGRESS", expectedVersion: version } };
    case "RESOLVE":
      return { path: "status", body: { status: "PENDING_CONFIRMATION", note: state.resolveNote.trim(), expectedVersion: version } };
    case "COMMENT":
      return { path: "comment", body: { text: state.commentText.trim(), visibleToResident: state.commentVisible } };
    case "CATEGORY":
      return { path: "category", body: { category: state.category, expectedVersion: version } };
    case "ACKNOWLEDGE":
      return { path: "acknowledge", body: {} };
    case "CLOSE":
      return { path: "close", body: { note: state.closeNote.trim() } };
  }
}

/**
 * What an answer of the routes means. 409 is STALE or INVALID_TRANSITION: the complaint changed under the person's feet, so the page asks for a reload.
 * 422 with the code ASSIGNEE_INVALID is its own message; any other 422 is VALIDATION. 401 and 403 are FORBIDDEN, 404 is NOT_FOUND.
 */
export function classifyPanelResponse(status: number, code: string | null): "OK" | PanelError {
  if (status === 200) return "OK";
  if (status === 409) return "STALE";
  if (status === 401 || status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 422) return code === "ASSIGNEE_INVALID" ? "ASSIGNEE_INVALID" : "VALIDATION";
  return "SERVER";
}
