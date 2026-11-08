const Z_95 = 1.959964;

export type Interval = { rate: number; lo: number; hi: number };

/** The 95 percent Wilson score interval for k successes in n trials (n = 0 gives the whole range 0 to 1). */
export function wilson(k: number, n: number, z: number = Z_95): Interval {
  if (n === 0) return { rate: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
