/** Bytes are asked for in batches of four words. A rejected word is rare, so one batch almost always suffices. */
const BATCH_BYTES = 16;
const WORD_COUNT = 2 ** 32;
/** After this many rejected words the byte source is treated as broken. */
export const MAX_REJECTED_WORDS = 1000;

/**
 * A numeric one-time code of `digits` digits, with leading zeros kept.
 *
 * Each 32-bit big-endian word is accepted only when it is below floor(2^32 / 10^digits) * 10^digits.
 * That makes every code equally likely: a plain modulo would favour the codes below 2^32 mod 10^digits.
 * The caller supplies the random bytes (the server uses the operating system's generator), so this
 * function stays pure and testable. It throws a RangeError when the digit count is not an integer
 * from 4 to 9, when the source returns the wrong number of bytes, and when MAX_REJECTED_WORDS words
 * have been rejected in one call.
 */
export function otpFromRandom(nextBytes: (n: number) => Uint8Array, digits: number): string {
  if (!Number.isInteger(digits) || digits < 4 || digits > 9) {
    throw new RangeError(`digits must be an integer from 4 to 9, got ${digits}`);
  }
  const modulus = 10 ** digits;
  const limit = Math.floor(WORD_COUNT / modulus) * modulus;
  let rejected = 0;
  for (;;) {
    const bytes = nextBytes(BATCH_BYTES);
    if (bytes.length !== BATCH_BYTES) throw new RangeError(`nextBytes(${BATCH_BYTES}) returned ${bytes.length} bytes`);
    for (let at = 0; at < BATCH_BYTES; at += 4) {
      const word = bytes[at] * 2 ** 24 + bytes[at + 1] * 2 ** 16 + bytes[at + 2] * 2 ** 8 + bytes[at + 3];
      if (word < limit) return String(word % modulus).padStart(digits, "0");
      rejected += 1;
      if (rejected >= MAX_REJECTED_WORDS) throw new RangeError(`${MAX_REJECTED_WORDS} random words were rejected`);
    }
  }
}
