/**
 * The median of a list of numbers, or null for an empty list. The rule for an EVEN count is the LOWER of the two middle values, so a median is always a
 * value that was observed (never a half) and a report in whole days or whole minutes never invents a fraction. Callers pass whole numbers. The input is not changed.
 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/** `n` out of `d` as a whole percent, rounded half up, or null when `d` is 0 (there is nothing to take a share of: the screen says "no data", never 0 percent). */
export function percent(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.floor((200 * n + d) / (2 * d));
}

/** Is `n` out of `d` at least `targetPercent`? Worked out on the counts, not on the rounded percent, so 89.6 percent is not "90". False when `d` is 0. */
export const atLeastPercent = (n: number, d: number, targetPercent: number): boolean => d > 0 && n * 100 >= targetPercent * d;

/** Is `n` out of `d` at most `maxPercent`? Worked out on the counts. False when `d` is 0. */
export const atMostPercent = (n: number, d: number, maxPercent: number): boolean => d > 0 && n * 100 <= maxPercent * d;
