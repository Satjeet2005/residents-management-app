/**
 * Error logging that explains a failure without leaking anything (D111). One line of JSON, so the host's log search can filter it:
 * `{ msg: "route failed", route, errorName, code, message }`. It never logs a request body, header, cookie, phone number or code:
 * the only inputs are the route path and the error itself, and the error's message is redacted first.
 */

/** The variables whose exact values must never appear in a log line. */
export const SECRET_ENV_NAMES = ["DATABASE_URL", "OTP_PEPPER", "PAYMENT_WEBHOOK_SECRET", "SESSION_SECRET", "LLM_API_KEY"] as const;

export const MAX_LOGGED_MESSAGE_CHARS = 300;
const MAX_LOGGED_ROUTE_CHARS = 100;
const REDACTED = "[secret]";

const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/\S+/gi;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9+/=_-]{32,}/g;

/**
 * Removes secrets from text: the exact values of the secret variables that are set, any postgres:// or postgresql:// URL, and any
 * run of 32 or more token characters (keys, hashes, tokens). The exact values go first, longest first, so a value that contains
 * another is replaced whole.
 */
export function redact(text: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const exact = SECRET_ENV_NAMES.map((name) => env[name]).filter((value): value is string => typeof value === "string" && value !== "");
  exact.sort((a, b) => b.length - a.length);
  let result = text;
  for (const value of exact) result = result.split(value).join(REDACTED);
  return result.replace(DATABASE_URL_PATTERN, REDACTED).replace(LONG_TOKEN_PATTERN, REDACTED);
}

/** A Postgres SQLSTATE (23505) or a Prisma code (P1001): exactly five characters, digits and capitals. */
const CODE_PATTERN = /^[0-9A-Z]{5}$/;

/** The code of the error, or of its `cause` chain (at most 3 deep, so a circular cause cannot loop). */
function codeOf(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 3) return null;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string" && CODE_PATTERN.test(code)) return code;
  return codeOf(cause, depth + 1);
}

function nameOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return error.constructor?.name || error.name || "Error";
}

/** Strings are logged (redacted); any other thrown value is described by a fixed text, never printed. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "a value that is not an Error was thrown";
}

/** The one place a failed route is logged. It never throws. */
export function logRouteError(route: string, error: unknown, env: Readonly<Record<string, string | undefined>> = process.env): void {
  try {
    console.error(
      JSON.stringify({
        msg: "route failed",
        route: redact(route, env).slice(0, MAX_LOGGED_ROUTE_CHARS),
        errorName: redact(nameOf(error), env).slice(0, MAX_LOGGED_ROUTE_CHARS),
        code: codeOf(error),
        message: redact(messageOf(error), env).slice(0, MAX_LOGGED_MESSAGE_CHARS),
      }),
    );
  } catch {
    console.error('{"msg":"route failed","route":null,"errorName":"LogFailure","code":null,"message":"the error could not be described"}');
  }
}
