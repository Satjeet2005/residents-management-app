/**
 * A name made comparable: upper case, apostrophes removed, any other
 * punctuation turned into a space, runs of spaces collapsed. "R.K. O'Brien"
 * becomes "R K OBRIEN". Letters of any script are kept.
 */
export function normalizeName(text: string): string {
  return text
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
