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

export type NameMatchStrength = "EXACT" | "INITIAL" | "TRUNCATED" | "NONE";

const HONORIFICS: ReadonlySet<string> = new Set(["MR", "MRS", "MS", "MISS", "SHRI", "SMT", "DR"]);

/** The words of a name, normalised, without honorifics. */
function nameWords(text: string): string[] {
  return normalizeName(text).split(" ").filter((word) => word !== "" && !HONORIFICS.has(word));
}

/** 0: same word, 1: one is a prefix of at least 4 letters of the other, 2: one is the initial of the other, null: no relation. */
function pairRank(x: string, y: string): 0 | 1 | 2 | null {
  if (x === y) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length === 1 && long.startsWith(short)) return 2;
  if (short.length >= 4 && long.startsWith(short)) return 1;
  return null;
}

const MAX_WORDS = 6;

/**
 * How well a name on a bank narration matches a resident's name.
 *
 * - EXACT: the same words in any order.
 * - TRUNCATED: the words pair up, and at least one pair is cut short (a prefix of 4 or more letters, "KULKAR" for "Kulkarni").
 * - INITIAL: the words pair up, and at least one pair is an initial and its full word ("S" for "Shaikh").
 * - NONE: anything else, including a different number of words.
 *
 * At least one pair must be a whole word or a cut-short word of 2 or more letters, so "R S" never matches "Rahul Sharma".
 * Honorifics (MR, MRS, MS, MISS, SHRI, SMT, DR) are ignored.
 *
 * A name alone never identifies a flat. Many people share a name, a payer may
 * pay for someone else, and banks cut names. A name can only support a match
 * that another signal (a flat code, a known payer) already points to.
 */
export function nameMatchStrength(remitter: string, residentName: string): NameMatchStrength {
  const a = nameWords(remitter);
  const b = nameWords(residentName);
  if (a.length === 0 || a.length !== b.length || a.length > MAX_WORDS) return "NONE";
  if ([...a].sort().join(" ") === [...b].sort().join(" ")) return "EXACT";

  const search = (i: number, used: number, worst: number, strong: boolean): number => {
    if (i === a.length) return strong ? worst : Infinity;
    let best = Infinity;
    for (let j = 0; j < b.length; j++) {
      if ((used & (1 << j)) !== 0) continue;
      const rank = pairRank(a[i], b[j]);
      if (rank === null) continue;
      const isStrong = rank === 1 || (rank === 0 && a[i].length >= 2);
      best = Math.min(best, search(i + 1, used | (1 << j), Math.max(worst, rank), strong || isStrong));
    }
    return best;
  };
  const worst = search(0, 0, 0, false);
  if (worst === 1) return "TRUNCATED";
  if (worst === 2) return "INITIAL";
  return "NONE";
}
