export type BreakerOptions = { failures: number; cooldownMs: number; now: () => number };

/**
 * A circuit breaker for one provider (D141): CLOSED until `failures` failures in a row, then OPEN for the cooldown (calls are skipped), then HALF-OPEN
 * with exactly ONE trial request; a success closes it, a failure opens it again for a full cooldown. Its state is in module memory: it resets on a
 * cold start and is NOT shared between serverless instances (documented in docs/classifier-providers.md). The clock is injected so a test can move it.
 */
export class CircuitBreaker {
  private consecutive = 0;
  /** 0 while closed; otherwise the instant the cooldown ends. */
  private openUntil = 0;
  private trialInFlight = false;

  constructor(private readonly options: BreakerOptions) {}

  /** May a request go to the provider now? In the half-open state this hands out the single trial, so the caller must report its outcome. */
  allow(): boolean {
    if (this.openUntil === 0) return true;
    if (this.options.now() < this.openUntil) return false;
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  /** Would `allow()` say yes now? It does not hand out the trial, so it can be asked to plan how to share a time budget. */
  canAttempt(): boolean {
    return this.openUntil === 0 || (this.options.now() >= this.openUntil && !this.trialInFlight);
  }

  /** The request succeeded: closed again. */
  success(): void {
    this.consecutive = 0;
    this.openUntil = 0;
    this.trialInFlight = false;
  }

  /** The request failed. Returns true when this failure opened the breaker (or opened it again after a failed trial). */
  failure(): boolean {
    if (this.openUntil !== 0) {
      this.open(this.options.cooldownMs);
      return true;
    }
    this.consecutive += 1;
    if (this.consecutive < this.options.failures) return false;
    this.open(this.options.cooldownMs);
    return true;
  }

  /** Opens at once for `forMs` (the cooldown by default): a rejected key, or a rate limit. Returns true when it was closed before. */
  trip(forMs: number = this.options.cooldownMs): boolean {
    const wasClosed = this.openUntil === 0;
    this.open(forMs);
    return wasClosed;
  }

  private open(forMs: number): void {
    this.consecutive = 0;
    this.trialInFlight = false;
    this.openUntil = this.options.now() + forMs;
  }
}
