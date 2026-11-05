import { describe, expect, it } from "vitest";
import { otpFromRandom } from "@/domain/auth/otp";
import { createPrng } from "@/domain/seed/prng";

/**
 * AU2 uniformity.
 *
 * 60,000 six-digit codes from a seeded generator (mulberry32, seed 1), so the test is the same on every run.
 * At each of the 6 positions each digit is expected 6,000 times. For a fair code the count is binomial with
 * a standard deviation of sqrt(60000 * 0.1 * 0.9) = 73.5, so the 3% tolerance (180) is 2.45 standard
 * deviations. One count is out of range 1.4% of the time, so with 60 counts a fair generator fails about 58%
 * of the time on a random seed. The seed is therefore fixed and written down: seed 1 was the first one tried
 * and it passes. This test catches a gross skew (a digit that is missing or doubled). It cannot see the
 * modulo bias that the rejection step removes for 6 digits: that bias is 1 part in 4,294. The rejection
 * tests in otp.test.ts cover it, with exact words around the limit.
 */
const SEED = 1;
const DRAWS = 60_000;
const DIGITS = 6;
const EXPECTED = DRAWS / 10;
const TOLERANCE = 0.03;

describe("AU2 otpFromRandom uniformity", () => {
  it("each digit appears within 3% of the expected count at each position", () => {
    const rng = createPrng(SEED);
    const nextBytes = (n: number) => Uint8Array.from({ length: n }, () => rng.int(0, 255));
    const counts = Array.from({ length: DIGITS }, () => new Array<number>(10).fill(0));
    for (let i = 0; i < DRAWS; i++) {
      const code = otpFromRandom(nextBytes, DIGITS);
      expect(code).toMatch(/^[0-9]{6}$/);
      for (let position = 0; position < DIGITS; position++) counts[position][Number(code[position])] += 1;
    }
    const worst = Math.max(...counts.flatMap((row) => row.map((count) => Math.abs(count - EXPECTED) / EXPECTED)));
    expect(worst).toBeLessThan(TOLERANCE);
    for (const row of counts) expect(row.reduce((a, b) => a + b, 0)).toBe(DRAWS);
  });
});
