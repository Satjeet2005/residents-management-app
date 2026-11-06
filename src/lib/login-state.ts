/**
 * The login form as a pure state machine (D16, D94): phone, then the one-time code. The component only dispatches
 * actions and shows the state, so every step can be tested without a browser. The wording is in the message catalog.
 */
export type LoginError = "INVALID_PHONE" | "TOO_MANY" | "NOT_ACCEPTED" | "LOCKED" | "NETWORK" | "SERVER";

export type LoginState = {
  step: "PHONE" | "CODE";
  phone: string;
  code: string;
  busy: "NONE" | "SENDING" | "VERIFYING";
  error: LoginError | null;
  /** Seconds left of a wait: after "too many tries", or the pause before another code. Counts down by TICK. */
  waitSeconds: number;
  /** The code the demo server returned, shown in a banner. Null when the server sent none. */
  demoCode: string | null;
};

export const initialLoginState: LoginState = { step: "PHONE", phone: "", code: "", busy: "NONE", error: null, waitSeconds: 0, demoCode: null };

export const PHONE_MAX_LENGTH = 20;
export const CODE_LENGTH = 6;

export type LoginAction =
  | { type: "PHONE_CHANGED"; value: string }
  | { type: "CODE_CHANGED"; value: string }
  | { type: "SEND_STARTED" }
  | { type: "SEND_SUCCEEDED"; demoCode: string | null; retryAfterSeconds: number }
  | { type: "SEND_FAILED"; error: LoginError; retryAfterSeconds?: number }
  | { type: "VERIFY_STARTED" }
  | { type: "VERIFY_FAILED"; error: LoginError; retryAfterSeconds?: number }
  | { type: "VERIFY_SUCCEEDED" }
  | { type: "CHANGE_NUMBER" }
  | { type: "TICK" };

const whole = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0);

export function loginReducer(state: LoginState, action: LoginAction): LoginState {
  switch (action.type) {
    case "PHONE_CHANGED":
      return { ...state, phone: action.value.slice(0, PHONE_MAX_LENGTH), error: state.error === "INVALID_PHONE" ? null : state.error };
    case "CODE_CHANGED":
      return { ...state, code: action.value.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH), error: state.error === "NOT_ACCEPTED" ? null : state.error };
    case "SEND_STARTED":
      return { ...state, busy: "SENDING", error: null };
    case "SEND_SUCCEEDED":
      return { ...state, step: "CODE", code: "", busy: "NONE", error: null, waitSeconds: whole(action.retryAfterSeconds), demoCode: action.demoCode };
    case "SEND_FAILED":
      return { ...state, busy: "NONE", error: action.error, waitSeconds: action.error === "TOO_MANY" ? Math.max(1, whole(action.retryAfterSeconds)) : state.waitSeconds };
    case "VERIFY_STARTED":
      return { ...state, busy: "VERIFYING", error: null };
    case "VERIFY_FAILED":
      return {
        ...state,
        busy: "NONE",
        error: action.error,
        code: action.error === "NOT_ACCEPTED" ? "" : state.code,
        waitSeconds: action.error === "TOO_MANY" ? Math.max(1, whole(action.retryAfterSeconds)) : state.waitSeconds,
      };
    case "VERIFY_SUCCEEDED":
      return { ...state, busy: "VERIFYING", error: null };
    case "CHANGE_NUMBER":
      return { ...initialLoginState, phone: state.phone };
    case "TICK": {
      const waitSeconds = Math.max(0, state.waitSeconds - 1);
      return { ...state, waitSeconds, error: waitSeconds === 0 && state.error === "TOO_MANY" ? null : state.error };
    }
  }
}

export type RequestOutcome =
  | { kind: "SENT"; demoCode: string | null; retryAfterSeconds: number }
  | { kind: "FAILED"; error: LoginError; retryAfterSeconds?: number };
export type VerifyOutcome = { kind: "OK"; redirectTo: string } | { kind: "FAILED"; error: LoginError; retryAfterSeconds?: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Seconds to wait from a 429: the Retry-After header, else the body's retryAfterSeconds, else 30. */
function retryAfter(header: string | null, body: unknown): number {
  const fromHeader = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(fromHeader) && fromHeader >= 1) return Math.ceil(fromHeader);
  const fromBody = isRecord(body) && typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : Number.NaN;
  return Number.isFinite(fromBody) && fromBody >= 1 ? Math.ceil(fromBody) : 30;
}

/** What a response from POST /api/auth/otp/request means. */
export function classifyRequest(status: number, body: unknown, retryAfterHeader: string | null): RequestOutcome {
  const error = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (status === 200 && isRecord(body) && body.message === "OTP_SENT_GENERIC") {
    return {
      kind: "SENT",
      demoCode: typeof body.demoCode === "string" && /^[0-9]{4,9}$/.test(body.demoCode) ? body.demoCode : null,
      retryAfterSeconds: typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : 30,
    };
  }
  if (status === 429) return { kind: "FAILED", error: "TOO_MANY", retryAfterSeconds: retryAfter(retryAfterHeader, body) };
  if (status === 400 && (error === "INVALID_PHONE" || error === "INVALID_REQUEST")) return { kind: "FAILED", error: "INVALID_PHONE" };
  return { kind: "FAILED", error: "SERVER" };
}

/** What a response from POST /api/auth/otp/verify means. */
export function classifyVerify(status: number, body: unknown, retryAfterHeader: string | null): VerifyOutcome {
  const error = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (status === 200 && isRecord(body) && typeof body.redirectTo === "string" && body.redirectTo.startsWith("/")) return { kind: "OK", redirectTo: body.redirectTo };
  if (status === 429) return { kind: "FAILED", error: "TOO_MANY", retryAfterSeconds: retryAfter(retryAfterHeader, body) };
  if (status === 400 && error === "OTP_LOCKED") return { kind: "FAILED", error: "LOCKED" };
  if (status === 400 && (error === "OTP_NOT_ACCEPTED" || error === "INVALID_REQUEST")) return { kind: "FAILED", error: "NOT_ACCEPTED" };
  return { kind: "FAILED", error: "SERVER" };
}
