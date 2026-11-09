import type { ProviderConfig } from "./config";
import { buildRequest, parseResponse, type PromptVersion, type SystemOneDistributions } from "./system-one";

/** The largest response body read, in bytes (D140). A System One answer for two questions is a few hundred bytes. */
export const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Why a call failed. CONFIG is a 401 or 403 (a key or an account problem: the breaker opens at once, D142); RATE_LIMITED is a 429;
 * SERVER is a 5xx; REJECTED is any other 4xx; REDIRECT is a 3xx (never followed); TOO_LARGE, INVALID (not JSON, or not a valid answer);
 * TIMEOUT (the call's own limit); ABORTED (the caller's signal, the budget); NETWORK (no answer at all).
 */
export type FailureKind = "CONFIG" | "RATE_LIMITED" | "SERVER" | "REJECTED" | "REDIRECT" | "TOO_LARGE" | "INVALID" | "TIMEOUT" | "ABORTED" | "NETWORK";

export type CallOutcome =
  | { ok: true; value: SystemOneDistributions; status: number; latencyMs: number }
  | { ok: false; failure: FailureKind; status?: number; latencyMs: number; retryAfterSeconds?: number };

export type CallOptions = { timeoutMs: number; signal?: AbortSignal };
export type ClientDeps = { fetch?: typeof fetch; now?: () => number; promptVersion?: PromptVersion };

/** `Retry-After` as a whole number of seconds; an HTTP date or anything else is "not given". */
function retryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

/** The body as text, or null when it is larger than the limit (the rest is never read). */
async function readLimited(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * One System One provider (D140). `call` makes ONE request, never retries, never follows a redirect, and never throws: it returns the validated
 * distributions or the kind of failure. The request carries the Bearer key and a body of only the model, the text and the questions.
 */
export class JevClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly deps: ClientDeps = {},
  ) {}

  get name(): string {
    return this.config.name;
  }

  async call(deidentifiedText: string, options: CallOptions): Promise<CallOutcome> {
    const now = this.deps.now ?? Date.now;
    const started = now();
    const elapsed = (): number => Math.max(0, now() - started);
    const timeout = AbortSignal.timeout(Math.max(1, Math.floor(options.timeoutMs)));
    const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
    try {
      const response = await (this.deps.fetch ?? fetch)(this.config.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(buildRequest(deidentifiedText, this.config.model, this.deps.promptVersion)),
        redirect: "manual",
        signal,
      });
      const { status } = response;
      if (status >= 200 && status < 300) return await this.accept(response, elapsed, status);
      await response.body?.cancel().catch(() => undefined);
      if (status === 401 || status === 403) return { ok: false, failure: "CONFIG", status, latencyMs: elapsed() };
      if (status === 429) return { ok: false, failure: "RATE_LIMITED", status, latencyMs: elapsed(), retryAfterSeconds: retryAfter(response.headers.get("retry-after")) };
      if (status >= 300 && status < 400) return { ok: false, failure: "REDIRECT", status, latencyMs: elapsed() };
      return { ok: false, failure: status >= 500 ? "SERVER" : "REJECTED", status, latencyMs: elapsed() };
    } catch {
      return { ok: false, failure: options.signal?.aborted ? "ABORTED" : timeout.aborted ? "TIMEOUT" : "NETWORK", latencyMs: elapsed() };
    }
  }

  private async accept(response: Response, elapsed: () => number, status: number): Promise<CallOutcome> {
    const text = await readLimited(response);
    if (text === null) return { ok: false, failure: "TOO_LARGE", status, latencyMs: elapsed() };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, failure: "INVALID", status, latencyMs: elapsed() };
    }
    const value = parseResponse(json);
    return value === null ? { ok: false, failure: "INVALID", status, latencyMs: elapsed() } : { ok: true, value, status, latencyMs: elapsed() };
  }
}
