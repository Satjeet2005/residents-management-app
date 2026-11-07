import { istDateOf } from "@/domain/time/calendar";

/**
 * A call counter for one provider, per India day (D141). Once `limit` calls were made today the provider is skipped until midnight IST, when the
 * count starts again. The clock is the business clock, injected. The count is in module memory: a cold start resets it and serverless instances do not
 * share it, so the real daily total can be a multiple of the limit (documented in docs/classifier-providers.md).
 */
export class DailyCap {
  private day = "";
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
  ) {}

  private roll(): void {
    const today = istDateOf(this.now());
    if (today === this.day) return;
    this.day = today;
    this.count = 0;
  }

  /** Is there room for one more call today? */
  hasRoom(): boolean {
    this.roll();
    return this.count < this.limit;
  }

  /** Counts one call made now. */
  take(): void {
    this.roll();
    this.count += 1;
  }
}
