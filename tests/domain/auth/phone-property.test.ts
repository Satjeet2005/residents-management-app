import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/domain/auth/phone";
import { createPrng, type Prng } from "@/domain/seed/prng";

const digits = (rng: Prng, n: number): string => Array.from({ length: n }, () => String(rng.int(0, 9))).join("");
const validNational = (rng: Prng): string => String(rng.int(5, 9)) + digits(rng, 9);

/** Puts a separator (or none) between some digits, as people type numbers. */
function withSeparators(rng: Prng, text: string): string {
  let out = "";
  for (const ch of text) {
    out += ch;
    if (rng.chance(0.2)) out += rng.pick([" ", "-", "  ", " - "]);
  }
  return out;
}

describe("AU1 normalizePhone properties (seeded)", () => {
  it("a valid number with any prefix, separators and surrounding spaces gives the same 10 digits", () => {
    const rng = createPrng(20261105);
    for (let i = 0; i < 3000; i++) {
      const national = validNational(rng);
      const prefix = rng.pick(["", "+91", "91", "0", "+91 ", "+91-", "91 ", "0 "]);
      const body = rng.chance(0.3) ? `(${national.slice(0, 5)}) ${national.slice(5)}` : withSeparators(rng, national);
      const input = `${rng.pick(["", " ", "  ", "\t"])}${prefix}${body}${rng.pick(["", " ", "  "])}`;
      expect(normalizePhone(input), input).toBe(national);
    }
  });

  it("a number whose first digit is 0 to 4 is rejected with every prefix", () => {
    const rng = createPrng(7);
    for (let i = 0; i < 1000; i++) {
      const national = String(rng.int(0, 4)) + digits(rng, 9);
      const input = rng.pick(["", "+91", "91", "0"]) + national;
      expect(normalizePhone(input), input).toBeNull();
    }
  });

  it("a number with a letter in it is rejected", () => {
    const rng = createPrng(11);
    for (let i = 0; i < 1000; i++) {
      const national = validNational(rng);
      const at = rng.int(0, national.length);
      const letter = rng.pick(["a", "O", "l", "x", "Z"]);
      const input = national.slice(0, at) + letter + national.slice(at);
      expect(normalizePhone(input), input).toBeNull();
    }
  });

  it("a number with the wrong count of digits is rejected", () => {
    const rng = createPrng(13);
    for (let i = 0; i < 1000; i++) {
      const length = rng.pick([1, 5, 8, 9, 13, 14, 20]);
      const input = String(rng.int(5, 9)) + digits(rng, length - 1);
      expect(normalizePhone(input), input).toBeNull();
    }
  });

  it("the result is always 10 digits starting 5 to 9, and normalising it again changes nothing", () => {
    const rng = createPrng(17);
    for (let i = 0; i < 2000; i++) {
      const input = rng.pick(["", "+91", "91", "0", "+", "1"]) + withSeparators(rng, digits(rng, rng.int(8, 13)));
      const result = normalizePhone(input);
      if (result !== null) {
        expect(result).toMatch(/^[5-9][0-9]{9}$/);
        expect(normalizePhone(result)).toBe(result);
      }
    }
  });
});
