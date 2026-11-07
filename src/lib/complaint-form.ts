import { COMPLAINT_BODY_MAX } from "@/domain/complaints/body";

/**
 * The "Raise a complaint" form as a pure state machine (D121, D127). The danger question has NO default: it starts unanswered and a submit
 * without an answer is refused here, before anything is sent. The component only dispatches actions and draws the state.
 */
export type DangerAnswer = "YES" | "NO";
export type FieldError = "BODY_REQUIRED" | "DANGER_REQUIRED";
export type SubmitError = "VALIDATION" | "NO_FLAT" | "RATE_LIMITED" | "NETWORK" | "SERVER";

export type ComplaintFormState = {
  body: string;
  danger: DangerAnswer | null;
  busy: boolean;
  fieldErrors: readonly FieldError[];
  submitError: SubmitError | null;
};

export const initialComplaintForm: ComplaintFormState = { body: "", danger: null, busy: false, fieldErrors: [], submitError: null };

export type ComplaintFormAction =
  | { type: "BODY_CHANGED"; value: string }
  | { type: "DANGER_CHOSEN"; value: DangerAnswer }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_FAILED"; error: SubmitError };

/** The characters of a text, counted as people count them (an emoji or a Devanagari letter with a sign is not two units). */
export const charCount = (text: string): number => Array.from(text).length;
const limit = (text: string): string => (charCount(text) <= COMPLAINT_BODY_MAX ? text : Array.from(text).slice(0, COMPLAINT_BODY_MAX).join(""));

/**
 * What is wrong with the form, in the order the page shows it. The danger answer is always required. The text is required unless the answer
 * is Yes: someone in danger may send the report with nothing written (the server stores "(no description)", D121).
 */
export function fieldErrorsOf(state: Pick<ComplaintFormState, "body" | "danger">): FieldError[] {
  const errors: FieldError[] = [];
  if (state.body.trim() === "" && state.danger !== "YES") errors.push("BODY_REQUIRED");
  if (state.danger === null) errors.push("DANGER_REQUIRED");
  return errors;
}

export function complaintFormReducer(state: ComplaintFormState, action: ComplaintFormAction): ComplaintFormState {
  switch (action.type) {
    case "BODY_CHANGED":
      return { ...state, body: limit(action.value), fieldErrors: state.fieldErrors.filter((e) => e !== "BODY_REQUIRED" || action.value.trim() === ""), submitError: null };
    case "DANGER_CHOSEN": {
      const next = { ...state, danger: action.value, submitError: null };
      return { ...next, fieldErrors: state.fieldErrors.length === 0 ? [] : fieldErrorsOf(next) };
    }
    case "SUBMIT": {
      if (state.busy) return state;
      const fieldErrors = fieldErrorsOf(state);
      return fieldErrors.length > 0 ? { ...state, fieldErrors, submitError: null } : { ...state, busy: true, fieldErrors: [], submitError: null };
    }
    case "SUBMIT_FAILED":
      return { ...state, busy: false, submitError: action.error };
  }
}

/** True once a SUBMIT would be sent (the answer is given, and there is text or the answer is Yes). */
export const readyToSend = (state: ComplaintFormState): boolean => fieldErrorsOf(state).length === 0;

/** The request body of POST /api/complaints. A danger answer of null never reaches here: `SUBMIT` refuses it. */
export const requestBodyOf = (state: Pick<ComplaintFormState, "body" | "danger">): { body: string; declaredDanger: boolean } => ({ body: state.body, declaredDanger: state.danger === "YES" });

export type CreateOutcome = { kind: "CREATED"; id: string } | { kind: "ERROR"; error: SubmitError };

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Reads the answer of POST /api/complaints. Only a UUID is followed to a page; anything unexpected is a server error. */
export function classifyCreate(status: number, json: unknown): CreateOutcome {
  const fields = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  if (status === 201 || status === 200) {
    const complaint = typeof fields.complaint === "object" && fields.complaint !== null ? (fields.complaint as Record<string, unknown>) : {};
    return isId(complaint.id) ? { kind: "CREATED", id: complaint.id } : { kind: "ERROR", error: "SERVER" };
  }
  if (status === 422 && fields.error === "VALIDATION") return { kind: "ERROR", error: "VALIDATION" };
  if (status === 422 && fields.error === "NO_FLAT") return { kind: "ERROR", error: "NO_FLAT" };
  if (status === 429) return { kind: "ERROR", error: "RATE_LIMITED" };
  return { kind: "ERROR", error: "SERVER" };
}
