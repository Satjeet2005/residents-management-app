/**
 * Logging that explains a failure without leaking anything (D111, D135). Every line is ONE line of JSON, so the host's log search can filter it.
 * It never logs a request body, header, cookie, complaint text, bank narration, phone number or code: the only inputs are a fixed list of
 * short fields (the route path, the method, a status, ids) and the error itself, and every text is redacted before it is cut.
 */
import { randomBytes } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

/** The variables whose exact values must never appear in a log line. `JEV_*_KEY` and `JEV_*_URL` are added by `secretValues`. */
export const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "OTP_PEPPER",
  "PAYMENT_WEBHOOK_SECRET",
  "SESSION_SECRET",
  "LLM_API_KEY",
  "LOGS_DATABASE_URL",
  "OPS_TEST_TOKEN",
] as const;

export const MAX_LOGGED_MESSAGE_CHARS = 300;
export const MAX_EVENT_MESSAGE_CHARS = 500;
export const MAX_STACK_FRAMES = 12;
export const MAX_STACK_CHARS = 4000;
const MAX_FIELD_CHARS = 100;
/** Text is cut to this before redaction so a huge message cannot cost much; the cut is far beyond any limit that is logged. */
const MAX_INPUT_CHARS = 20_000;
const REDACTED = "[secret]";

const CREDENTIAL_URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@\S*/gi;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/\S+/gi;
const AUTHORIZATION_PATTERN = /\bAuthorization\b["']?\s*[:=][^\r\n]*/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_PARAMETER_PATTERN = /(?<![A-Za-z0-9])((?:token|key|secret|password|passwd|pwd|otp|code|sig|signature)["']?\s*[:=]\s*["']?)[^\s&"',;]+/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Any script's decimal digits, so a number written in Devanagari digits is removed too. */
const LONG_DIGITS_PATTERN = /\p{Nd}{10,}/gu;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9+/=_-]{32,}/g;

/** The password inside a connection string, as written and decoded, so it is removed even when it appears without the rest of the URL. */
function passwordsIn(connectionString: string | undefined): string[] {
  try {
    const raw = new URL(connectionString ?? "").password;
    return raw === "" ? [] : [raw, decodeURIComponent(raw)];
  } catch {
    return [];
  }
}

/** The exact secret values that are set, longest first, so a value that contains another is replaced whole. */
function secretValues(env: Env): string[] {
  const names = [...SECRET_ENV_NAMES, ...Object.keys(env).filter((name) => /^JEV_.+_(KEY|URL)$/.test(name))];
  const values = [...names.map((name) => env[name]), ...passwordsIn(env.DATABASE_URL), ...passwordsIn(env.LOGS_DATABASE_URL)];
  return values.filter((value): value is string => typeof value === "string" && value !== "").sort((a, b) => b.length - a.length);
}

/**
 * Removes secrets from text, in this order: the exact values of the secret variables that are set (and database passwords); any URL that carries
 * credentials and any postgres:// URL; Authorization and Bearer values; `token=`, `password=` style assignments; e-mail addresses; runs of 10 or
 * more digits (phone and account numbers); and any run of 32 or more token characters (keys, hashes, tokens). It never throws.
 */
export function redact(text: string, env: Env = process.env): string {
  let result = text.slice(0, MAX_INPUT_CHARS);
  for (const value of secretValues(env)) result = result.split(value).join(REDACTED);
  return result
    .replace(CREDENTIAL_URL_PATTERN, REDACTED)
    .replace(DATABASE_URL_PATTERN, REDACTED)
    .replace(AUTHORIZATION_PATTERN, `Authorization: ${REDACTED}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(SECRET_PARAMETER_PATTERN, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(LONG_DIGITS_PATTERN, REDACTED)
    .replace(LONG_TOKEN_PATTERN, REDACTED);
}

/** Redacts, then cuts: a secret that straddles the cut is removed before it, so no piece of it is kept. */
const clean = (text: string, max: number, env: Env): string => redact(text, env).slice(0, max);

/** A Postgres SQLSTATE (23505) or a Prisma code (P1001): exactly five characters, digits and capitals. */
const CODE_PATTERN = /^[0-9A-Z]{5}$/;

/** The code of the error, or of its `cause` chain (at most 3 deep, so a circular cause cannot loop). */
export function codeOf(error: unknown, depth = 0): string | null {
  try {
    if (typeof error !== "object" || error === null || depth > 3) return null;
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && CODE_PATTERN.test(code)) return code;
    return codeOf(cause, depth + 1);
  } catch {
    return null;
  }
}

function nameOf(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "NonError";
    return error.constructor?.name || error.name || "Error";
  } catch {
    return "Error";
  }
}

/** Strings are logged (redacted); any other thrown value is described by a fixed text, never printed. */
function messageOf(error: unknown): string {
  try {
    if (error instanceof Error) return String(error.message);
    return typeof error === "string" ? error : "a value that is not an Error was thrown";
  } catch {
    return "the error could not be described";
  }
}

/** The "at ..." lines of the stack: the top frames only, without the message line (the message is stored on its own). */
function framesOf(error: unknown): string[] {
  try {
    if (!(error instanceof Error) || typeof error.stack !== "string") return [];
    return error.stack
      .slice(0, MAX_INPUT_CHARS)
      .split("\n")
      .filter((line) => /^\s*at /.test(line))
      .slice(0, MAX_STACK_FRAMES)
      .map((line) => line.trim());
  } catch {
    return [];
  }
}

export type ErrorDescription = { errorName: string; errorCode: string | null; message: string; stack: string | null; firstFrame: string | null };

/** What is known about a thrown value, redacted and within the limits (500 characters of message, 12 frames and 4,000 characters of stack). Never throws. */
export function describeError(error: unknown, env: Env = process.env): ErrorDescription {
  try {
    const frames = framesOf(error);
    return {
      errorName: clean(nameOf(error), MAX_FIELD_CHARS, env),
      errorCode: codeOf(error),
      message: clean(messageOf(error), MAX_EVENT_MESSAGE_CHARS, env),
      stack: frames.length === 0 ? null : clean(frames.join("\n"), MAX_STACK_CHARS, env),
      firstFrame: frames[0] ?? null,
    };
  } catch {
    return { errorName: "Error", errorCode: null, message: "the error could not be described", stack: null, firstFrame: null };
  }
}

export const LOG_SOURCES = ["ROUTE", "PAGE", "ACTION", "MIDDLEWARE", "PROVIDER", "JOB", "AUDIT", "TEST"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** The only fields a log line can carry. There is no place for a body, a header, a cookie, a complaint, a narration, a phone number or a code. */
export type EventFields = {
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  digest?: string;
  ref?: string;
  errorName?: string;
  code?: string | null;
  message?: string;
  stack?: string | null;
};

export type LogEventInput = EventFields & { level: "warn" | "error"; source: LogSource; msg: string };

/** The first 7 characters of the deployed commit, so a line says which build wrote it. */
export function deploymentOf(env: Env = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === "string" && sha !== "" ? sha.slice(0, 7) : null;
}

/** The line written when a line could not be built. Even this may fail (a closed stdout), and then nothing is left to do. */
function lastResort(line: string): void {
  try {
    console.error(line);
  } catch {
    // Nothing can be reported if the log itself is broken; a log call must never throw.
  }
}

const TEXT_FIELDS = ["route", "method", "requestId", "digest", "ref", "errorName", "code"] as const;

/** Writes ONE JSON line to stdout (warn to console.warn, error to console.error). Every text is redacted and cut; it never throws. */
export function logEvent(input: LogEventInput, env: Env = process.env): void {
  try {
    const line: Record<string, unknown> = { level: input.level, source: input.source, msg: clean(input.msg, MAX_FIELD_CHARS, env) };
    for (const field of TEXT_FIELDS) {
      const value = input[field];
      if (typeof value === "string" && value !== "") line[field] = clean(value, MAX_FIELD_CHARS, env);
    }
    if (typeof input.status === "number" && Number.isInteger(input.status)) line.status = input.status;
    if (typeof input.message === "string") line.message = clean(input.message, MAX_EVENT_MESSAGE_CHARS, env);
    if (typeof input.stack === "string") line.stack = clean(input.stack, MAX_STACK_CHARS, env);
    const deployment = deploymentOf(env);
    if (deployment !== null) line.deployment = clean(deployment, MAX_FIELD_CHARS, env);
    (input.level === "warn" ? console.warn : console.error)(JSON.stringify(line));
  } catch {
    lastResort('{"level":"error","source":"JOB","msg":"a log line could not be written"}');
  }
}

/** The characters of a reference: Crockford's base 32, which has no I, L, O or U, so a reference can be read aloud and typed without mistakes. */
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_LENGTH = 6;

/** A short reference to quote to the developer: "E-" and 6 characters, 30 bits from the system's random source. */
export function newRef(): string {
  const bytes = randomBytes(REF_LENGTH);
  return `E-${Array.from(bytes, (byte) => REF_ALPHABET[byte & 31]).join("")}`;
}

export type ErrorContext = Pick<EventFields, "route" | "method" | "status" | "requestId" | "digest"> & { source: LogSource; msg?: string; ref?: string };

/** Logs an unexpected error as one line of stdout and returns the reference that is in it. The caller shows the reference to the person. */
export function logError(error: unknown, context: ErrorContext, env: Env = process.env): string {
  const ref = context.ref ?? newRef();
  const description = describeError(error, env);
  logEvent(
    {
      level: "error",
      source: context.source,
      msg: context.msg ?? "unexpected error",
      ref,
      route: context.route,
      method: context.method,
      status: context.status,
      requestId: context.requestId,
      digest: context.digest,
      errorName: description.errorName,
      code: description.errorCode,
      message: description.message,
      stack: description.stack,
    },
    env,
  );
  return ref;
}

/** The first version of the route-failure line (D111), kept as it is: five fields, a 300 character message. */
export function logRouteError(route: string, error: unknown, env: Env = process.env): void {
  try {
    const description = describeError(error, env);
    console.error(
      JSON.stringify({
        msg: "route failed",
        route: clean(route, MAX_FIELD_CHARS, env),
        errorName: description.errorName,
        code: description.errorCode,
        message: description.message.slice(0, MAX_LOGGED_MESSAGE_CHARS),
      }),
    );
  } catch {
    lastResort('{"msg":"route failed","route":null,"errorName":"LogFailure","code":null,"message":"the error could not be described"}');
  }
}
