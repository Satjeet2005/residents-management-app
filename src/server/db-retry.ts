/** Postgres says "deadlock detected" (40P01) or "could not serialize" (40001); Prisma and its driver adapter carry the text in different places. */
export function isRetryableConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const text = `${String(e.code ?? "")} ${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {})} ${JSON.stringify(e.cause ?? {})}`;
  return /40P01|40001|deadlock detected|could not serialize|P2034/i.test(text);
}

export type DeadlockRetryOptions = {
  /** How many times to run the work again after a deadlock or serialization failure. */
  retries: number;
  /** Waits for the given milliseconds. A test passes a function that records the delay and returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, which must be ONE WHOLE transaction (it is run again from the start), and runs it again after a deadlock (SQLSTATE 40P01)
 * or a serialization failure (40001), at most `retries` more times, with a short jittered wait. Postgres rolled the failed
 * transaction back, so nothing of it is left. Any other error, and a conflict after the last retry, is thrown as it is (D115).
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, options: DeadlockRetryOptions): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.retries || !isRetryableConflict(error)) throw error;
      await sleep(10 + Math.floor(Math.random() * 40) * (attempt + 1));
    }
  }
}

/** The retry count used by the services that run one transaction. */
export const TRANSACTION_RETRIES = 2;
