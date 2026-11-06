import { describe, expect, it } from "vitest";
import { otpFromRandom } from "@/domain/auth/otp";
import { createPrng } from "@/domain/seed/prng";

/**
 * AU2 uniformity.
 *
 * 60,000 six-digit codes from a seeded generator (mulberry32), so the test is the same on every run.
 * At each of the 6 positions each digit is expected n * p = 60,000 * 0.1 = 6,000 times. For a fair code the
 * count of one cell is binomial with standard deviation sd = sqrt(n * p * (1 - p)) = 73.5.
 *
 * Why not a fixed 3%? 3% of 6,000 is 180, which is only 2.45 sd. One fair cell is that far out 1.4% of the
 * time, and there are 60 cells, so a fair generator would fail about 58% of random seeds. That bound was
 * statistically too tight: it passed seed 1 by luck. The bound is now 5 sd (about 367, 6.1%). A fair cell is
 * that far out about 6 times in 10 million, so 60 cells fail about 4 times in 100,000 per seed.
 *
 * It is run over three seeds. This test catches a gross skew (a digit missing or doubled). It cannot see the
 * modulo bias that the rejection step removes for 6 digits: that bias is 1 part in 4,294. The rejection tests
 * in otp.test.ts cover it, with exact words around the limit.
 */
const SEEDS = [1, 2, 3];
const DRAWS = 60_000;
const DIGITS = 6;
const P = 1 / 10;
const EXPECTED = DRAWS * P;
const SD = Math.sqrt(DRAWS * P * (1 - P));
const SIGMAS = 5;

describe("AU2 otpFromRandom uniformity", () => {
  it.each(SEEDS)("seed %i: each digit at each position is within 5 standard deviations of its expected count", (seed) => {
    const rng = createPrng(seed);
    const nextBytes = (n: number) => Uint8Array.from({ length: n }, () => rng.int(0, 255));
    const counts = Array.from({ length: DIGITS }, () => new Array<number>(10).fill(0));
    for (let i = 0; i < DRAWS; i++) {
      const code = otpFromRandom(nextBytes, DIGITS);
      expect(code).toMatch(/^[0-9]{6}$/);
      for (let position = 0; position < DIGITS; position++) counts[position][Number(code[position])] += 1;
    }
    const worst = Math.max(...counts.flatMap((row) => row.map((count) => Math.abs(count - EXPECTED))));
    expect(worst).toBeLessThan(SIGMAS * SD);
    for (const row of counts) expect(row.reduce((a, b) => a + b, 0)).toBe(DRAWS);
  });
});
