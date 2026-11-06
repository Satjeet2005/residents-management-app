/** How a term must stand in a text. WORD: whole word(s), nothing letter-like touching either side. STEM: only the start must be a word start, so inflections match. */
export type MatchKind = "WORD" | "STEM";

/** Nukta removed and chandrabindu made anusvara, so "फँस", "फंस" and a typed "फ़ंस" are one spelling. Applied to a text and to every term. */
export function foldDevanagari(text: string): string {
  return text.replace(/़/g, "").replace(/ँ/g, "ं");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HAS_DEVANAGARI = /[ऀ-ॿ]/;

/** One term as a pattern: a space is flexible (Latin: spaces, hyphens, underscores, at least one; Devanagari: any spaces). Linear time, no nesting. */
export function termPattern(term: string): string {
  const folded = foldDevanagari(term.toLowerCase());
  const separator = HAS_DEVANAGARI.test(folded) ? "\\s*" : "[\\s\\-_]+";
  return folded.split(" ").map(escapeRegExp).join(separator);
}

/** The pattern for a set of terms of one kind, global, with a word-start boundary on the left and, for WORD, a boundary on the right. */
export function compileTerms(terms: readonly string[], kind: MatchKind): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${terms.map(termPattern).join("|")})${kind === "WORD" ? "(?![\\p{L}\\p{M}\\p{N}])" : ""}`, "gu");
}

/** The text as the matchers read it: lower case, apostrophes dropped ("can't" is "cant"), Devanagari folded. Call it on already normalised text. */
export function foldForMatching(normalised: string): string {
  return foldDevanagari(normalised.toLowerCase().replace(/['’‘`´]/g, ""));
}
