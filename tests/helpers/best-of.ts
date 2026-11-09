/**
 * Time-bounded tests measure the BEST of several runs after one untimed warm-up. A real slowdown makes every run slow, so the
 * best still crosses the limit; a scheduler pause or a busy neighbour hits one run, not all of them. The limit is never raised.
 */
export const DEFAULT_RUNS = 5;

type Clock = () => number;
const defaultClock: Clock = () => performance.now();

/** Milliseconds of the fastest of `runs` timed calls, after one untimed warm-up call. */
export function bestOfMs(work: () => unknown, runs: number = DEFAULT_RUNS, clock: Clock = defaultClock): number {
  work();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const started = clock();
    work();
    best = Math.min(best, clock() - started);
  }
  return best;
}

/** The same for async work. Returns the fastest time and the result of the last timed call. */
export async function bestOfMsAsync<T>(work: () => Promise<T>, runs: number = DEFAULT_RUNS, clock: Clock = defaultClock): Promise<{ bestMs: number; result: T }> {
  await work();
  let best = Number.POSITIVE_INFINITY;
  let result: T | undefined;
  for (let i = 0; i < runs; i++) {
    const started = clock();
    result = await work();
    best = Math.min(best, clock() - started);
  }
  return { bestMs: best, result: result as T };
}
