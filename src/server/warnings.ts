/**
 * The small set of WARN events that are stored in error_events (D135), each at most once per cooldown per server instance. They use the server's
 * own database handle, because none of these places has a request. Ordinary 4xx, validation errors, rate limits, failed logins and 403 denials are
 * never recorded: a warning here means something is wrong with the deployment, not with a person's input.
 */
import { getDb } from "./db";
import { warnOnce } from "./error-log";

const MINUTE_MS = 60_000;

function warn(key: string, cooldownMs: number, errorName: string, message: string, route: string, source: "PROVIDER" | "JOB"): void {
  try {
    warnOnce(key, cooldownMs, { source, route, errorName, message }, getDb());
  } catch {
    // No database handle (DATABASE_URL missing): the stdout line is all there is.
  }
}

/** Deadlock retries ran out: a transaction failed three times in a row. */
export const warnDeadlockExhausted = (): void => warn("deadlock-exhausted", MINUTE_MS, "DeadlockRetriesExhausted", "a transaction was retried after a deadlock and still failed", "database", "JOB");

/** A classifier provider's circuit breaker opened. `cooldownMs` is the breaker's own cooldown, so it is reported once per opening. */
export const warnProviderBreakerOpened = (provider: string, cooldownMs: number): void =>
  warn(`breaker:${provider}`, cooldownMs, "ProviderBreakerOpened", `classifier provider ${provider} breaker opened`, "classifier", "PROVIDER");

/** A classifier provider answered 401 or 403: its key or URL is wrong. */
export const warnProviderAuthFailed = (provider: string, status: number | undefined, cooldownMs: number): void =>
  warn(`auth:${provider}`, cooldownMs, "ProviderAuthFailed", `classifier provider ${provider} refused its key (HTTP ${status ?? "unknown"})`, "classifier", "PROVIDER");

/** A complaint event names a person with something that is not a UUID (bad data, for example from an old seed): the page shows "someone" and this is logged once per instance and field. `field` is a fixed name, never data. */
export const warnUnusableEventId = (field: "payload.assignee"): void =>
  warn(`unusable-event-id:${field}`, 24 * 60 * MINUTE_MS, "UnusableEventId", `a complaint event holds ${field} that is not a UUID; it is shown as someone`, "complaint detail", "JOB");
