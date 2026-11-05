import { describe, expect, it } from "vitest";
import { MAX_REJECTED_WORDS, otpFromRandom } from "@/domain/auth/otp";

/** Four bytes, big-endian, for one 32-bit word. */
const wordBytes = (word: number): number[] => [(word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255];

/** A byte source that serves the words in order, and records every request size. */
function fromWords(words: readonly number[]) {
  const requests: number[] = [];
  let at = 0;
  const nextBytes = (n: number): Uint8Array => {
    requests.push(n);
    const out: number[] = [];
    for (let i = 0; i < n / 4; i++) out.push(...wordBytes(words[at++] ?? 0));
    return Uint8Array.from(out);
  };
  return { nextBytes, requests };
}

/** floor(2^32 / 10^6) * 10^6 */
const LIMIT_6 = 4294000000;

describe("AU2 otpFromRandom", () => {
  it("is deterministic for fixed bytes", () => {
    const first = otpFromRandom(fromWords([987654]).nextBytes, 6);
    const second = otpFromRandom(fromWords([987654]).nextBytes, 6);
    expect(first).toBe("987654");
    expect(second).toBe(first);
  });

  it.each([
    [123, 6, "000123"],
    [0, 6, "000000"],
    [999999, 6, "999999"],
    [1000000, 6, "000000"],
    [1234567, 6, "234567"],
    [42, 4, "0042"],
    [7, 9, "000000007"],
    [LIMIT_6 - 1, 6, "999999"],
  ])("word %i with %i digits gives %s", (word, digits, expected) => {
    const code = otpFromRandom(fromWords([word]).nextBytes, digits);
    expect(code).toBe(expected);
    expect(code).toHaveLength(digits);
  });

  it("reads the four bytes of a word as big-endian", () => {
    const bytes = Uint8Array.from([0, 1, 226, 64, ...new Array(12).fill(0)]);
    expect(otpFromRandom(() => bytes, 6)).toBe("123456");
  });

  it("skips a word at or above the limit and uses the next one", () => {
    const { nextBytes } = fromWords([LIMIT_6, 4294967295, 123456]);
    expect(otpFromRandom(nextBytes, 6)).toBe("123456");
  });

  it("accepts the word just below the limit and rejects the limit itself", () => {
    expect(otpFromRandom(fromWords([LIMIT_6 - 1, 5]).nextBytes, 6)).toBe("999999");
    expect(otpFromRandom(fromWords([LIMIT_6, 5]).nextBytes, 6)).toBe("000005");
  });

  it("rejects the biased words for 9 digits, where the bias is large", () => {
    expect(otpFromRandom(fromWords([4000000000, 3999999999]).nextBytes, 9)).toBe("999999999");
    expect(otpFromRandom(fromWords([4294967295, 4000000000, 17]).nextBytes, 9)).toBe("000000017");
  });

  it("asks for a small batch of whole words, and asks again only when a batch is used up", () => {
    const rejected = new Array(4).fill(4294967295);
    const { nextBytes, requests } = fromWords([...rejected, 55]);
    expect(otpFromRandom(nextBytes, 6)).toBe("000055");
    expect(requests).toEqual([16, 16]);
  });

  it("throws a RangeError when 1,000 words are rejected, and not when the 1,000th word is accepted", () => {
    expect(MAX_REJECTED_WORDS).toBe(1000);
    let calls = 0;
    const allRejected = (n: number) => {
      calls += 1;
      return new Uint8Array(n).fill(255);
    };
    expect(() => otpFromRandom(allRejected, 6)).toThrow(RangeError);
    expect(calls).toBe(250);

    const lastAccepted = fromWords([...new Array(999).fill(4294967295), 77]);
    expect(otpFromRandom(lastAccepted.nextBytes, 6)).toBe("000077");
    const noneAccepted = fromWords(new Array(1000).fill(4294967295));
    expect(() => otpFromRandom(noneAccepted.nextBytes, 6)).toThrow(RangeError);
  });

  it.each([3, 10, 0, -1, 4.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9])("throws a RangeError for %s digits", (digits) => {
    expect(() => otpFromRandom(fromWords([1]).nextBytes, digits)).toThrow(RangeError);
  });

  it.each([4, 5, 6, 7, 8, 9])("accepts %i digits", (digits) => {
    expect(otpFromRandom(fromWords([5]).nextBytes, digits)).toBe("5".padStart(digits, "0"));
  });

  it("throws a RangeError when the source returns the wrong number of bytes", () => {
    expect(() => otpFromRandom(() => new Uint8Array(4), 6)).toThrow(RangeError);
  });
});
