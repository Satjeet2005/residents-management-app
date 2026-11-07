import type { ArmResult, ClassifierInput } from "@/domain/complaints/decision";
import type { Classifier, ClassifierMeta, ClassifyOptions } from "../classifier";
import type { CircuitBreaker } from "./breaker";
import type { DailyCap } from "./cap";
import type { FailureKind, JevClient } from "./client";

export type ProviderLogFields = { provider: string; failure: FailureKind; status?: number; latencyMs: number };
export type ProviderLog = (fields: ProviderLogFields) => void;

/** The only text this module logs: fixed words, the provider NAME, the failure kind, the status and the latency. Never a URL, a key, a body or a complaint. */
export const logToConsole: ProviderLog = ({ provider, failure, status, latencyMs }) => {
  console.warn(`classifier provider failed: provider=${provider} failure=${failure} status=${status ?? "none"} latency_ms=${latencyMs}`);
};

export type ProviderSlot = { client: JevClient; breaker: CircuitBreaker; cap: DailyCap };
export type JevClassifierOptions = { timeoutMs: number; cooldownMs: number; now?: () => number; log?: ProviderLog };

/** Less than this is not worth a request: the time left is spent. */
const MIN_ATTEMPT_MS = 50;

/**
 * The classifier of the System One providers (D140): the primary first, then the secondary, then `null` so the keyword fallback runs. It stays inside the
 * caller's total budget: each attempt gets at most the call timeout and at most an equal share of the time left among the providers still available, and
 * every request is also tied to the caller's signal, so the request in flight is aborted when the budget ends. A provider whose daily cap is reached or
 * whose breaker is open is skipped silently. It never retries a provider within one request.
 */
export class JevClassifier implements Classifier {
  constructor(
    private readonly slots: readonly ProviderSlot[],
    private readonly options: JevClassifierOptions,
  ) {}

  async classify(input: ClassifierInput, options: ClassifyOptions = {}): Promise<(ArmResult & ClassifierMeta) | null> {
    const now = this.options.now ?? Date.now;
    const deadline = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : now() + options.budgetMs;
    for (let i = 0; i < this.slots.length; i += 1) {
      if (options.signal?.aborted) return null;
      const remaining = deadline - now();
      if (remaining < MIN_ATTEMPT_MS) return null;
      const slot = this.slots[i];
      if (!slot.cap.hasRoom() || !slot.breaker.allow()) continue;
      const available = this.slots.slice(i).filter((s) => s === slot || (s.cap.hasRoom() && s.breaker.canAttempt())).length;
      const timeoutMs = Math.max(MIN_ATTEMPT_MS, Math.min(this.options.timeoutMs, remaining / available));
      slot.cap.take();
      const outcome = await slot.client.call(input.text, { timeoutMs, signal: options.signal });
      if (outcome.ok) {
        slot.breaker.success();
        return { arm: "DIRECT", categories: outcome.value.categories, urgencies: outcome.value.urgencies, provider: slot.client.name, latencyMs: outcome.latencyMs };
      }
      this.recordFailure(slot, outcome);
    }
    return null;
  }

  /** A 401 or 403 opens the breaker at once and is logged once per cooldown (D142); a 429 opens it for Retry-After, up to the cooldown; the rest count. */
  private recordFailure(slot: ProviderSlot, outcome: { failure: FailureKind; status?: number; latencyMs: number; retryAfterSeconds?: number }): void {
    const log = this.options.log ?? logToConsole;
    const fields = { provider: slot.client.name, failure: outcome.failure, status: outcome.status, latencyMs: outcome.latencyMs };
    if (outcome.failure === "CONFIG") {
      if (slot.breaker.trip()) log(fields);
      return;
    }
    log(fields);
    if (outcome.failure === "RATE_LIMITED") {
      const asked = outcome.retryAfterSeconds === undefined ? this.options.cooldownMs : Math.max(1, outcome.retryAfterSeconds) * 1000;
      slot.breaker.trip(Math.min(asked, this.options.cooldownMs));
      return;
    }
    slot.breaker.failure();
  }
}
