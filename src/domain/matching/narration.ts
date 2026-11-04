import { extractFlatTokens, type FlatToken } from "./flat-code";
import { normalizeName } from "./names";

export type Rail = "UPI" | "NEFT" | "IMPS" | "RTGS" | "CHEQUE_DEPOSIT" | "CHEQUE_RETURN" | "CASH_DEPOSIT" | "BANK_CHARGE" | "INTEREST" | "UNKNOWN";

export type ParsedNarration = {
  rail: Rail;
  /** A UPI 12-digit reference, a NEFT or RTGS UTR, an IMPS reference or a cheque number. */
  reference: string | null;
  /** The UPI address, lower case, such as "aamir.s@oksbi". */
  vpa: string | null;
  /** The person who paid, normalised (see normalizeName). It may be cut short by the bank. */
  remitterName: string | null;
  flatTokens: FlatToken[];
  hints: { maintenance: boolean; rent: boolean; advance: boolean };
  /** The number of months a note names ("3 months", "3 mths"), or null. */
  months: number | null;
  /** The words that are not the rail, the reference, the flat or the name, upper case. Empty for UNKNOWN. */
  notes: string;
};

/** Only the first characters of a narration are read. The raw text is never changed or cut. */
const MAX_PARSED_CHARS = 1000;

const VPA_PATTERN = /[A-Za-z0-9._]{2,}@[A-Za-z][A-Za-z0-9]{1,20}/g;

/**
 * How each rail announces itself. These are synthetic patterns, not any bank's
 * specification. The rail whose keyword comes first in the text wins; on a tie
 * the earlier entry wins.
 */
const RAIL_PATTERNS: readonly (readonly [Rail, RegExp])[] = [
  ["CHEQUE_RETURN", /\b(?:(?:CHQ|CHEQUE|CHECK)\.?\s*(?:RET|RETURN|RETURNED|RTN|BOUNCE|BOUNCED)|(?:RET|RETURN|RETURNED)\s+(?:CHQ|CHEQUE|CHECK))\b/],
  ["BANK_CHARGE", /\b(?:(?:SMS|ATM|AMC|SERVICE|SERV|ANNUAL|NEFT|DEBIT CARD|MIN BAL|MINIMUM BALANCE)\s+(?:CHARGES?|CHGS?|FEES?)|BANK\s+CHARGES?|GST)\b/],
  ["INTEREST", /\b(?:INT\.?\s*PD|INT\.?\s*PAID|INT\.?\s*CR(?:EDIT)?|INTEREST)\b/],
  ["CASH_DEPOSIT", /\b(?:CASH\s*(?:DEP|DEPOSIT)|CDM|BY\s+CASH)\b/],
  ["CHEQUE_DEPOSIT", /\b(?:CHQ|CHEQUE|CHECK|CLG)\b/],
  ["UPI", /\bUPI\b/],
  ["NEFT", /\bNEFT\b/],
  ["IMPS", /\bIMPS\b/],
  ["RTGS", /\bRTGS\b/],
];

function detectRail(upper: string): Rail {
  let best: Rail = "UNKNOWN";
  let bestIndex = Infinity;
  for (const [rail, pattern] of RAIL_PATTERNS) {
    const index = pattern.exec(upper)?.index;
    if (index !== undefined && index < bestIndex) {
      best = rail;
      bestIndex = index;
    }
  }
  return best;
}

/** A 12-digit run is a UPI reference only on the UPI rail. On any other rail it is just a number. */
function upiReference(upper: string, rail: Rail): string | null {
  if (rail !== "UPI") return null;
  return /(?<![0-9])[0-9]{12}(?![0-9])/.exec(upper)?.[0] ?? null;
}

const countDigits = (token: string): number => token.replace(/[^0-9]/g, "").length;

function referenceOf(upper: string, rail: Rail): string | null {
  const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  switch (rail) {
    case "UPI":
      return upiReference(upper, rail);
    case "NEFT":
    case "RTGS":
      return tokens.find((t) => t.length >= 8 && t.length <= 22 && /[A-Z]/.test(t) && countDigits(t) >= 6) ?? null;
    case "IMPS":
      return tokens.find((t) => /^[0-9]{8,12}$/.test(t)) ?? null;
    case "CHEQUE_DEPOSIT":
    case "CHEQUE_RETURN":
      return tokens.find((t) => /^[0-9]{6}$/.test(t)) ?? null;
    default:
      return null;
  }
}

/** Words that name a rail, or a purpose or a note. They are never part of a person's name. */
const RAIL_WORDS: ReadonlySet<string> = new Set([
  "UPI", "NEFT", "IMPS", "RTGS", "CHQ", "CHEQUE", "CHECK", "DEP", "DEPOSIT", "CASH", "RET", "RETURN", "RETURNED", "SMS", "CHARGES", "INT", "PD", "INTEREST",
]);
const NOTE_WORDS: ReadonlySet<string> = new Set([
  "MAINT", "MAINTENANCE", "MAINTAINANCE", "MAINTANANCE", "MNTC", "MNT", "ADV", "ADVANCE", "ADVNC", "PREPAID", "RENT", "FLAT", "FLT", "NO", "TOWER", "TWR",
  "MONTH", "MONTHS", "MTH", "MTHS", "MNTH", "MNTHS", "MO", "MOS", "PAYMENT", "PAID", "PAY", "BILL", "DUES", "SOCIETY", "TRF", "TRANSFER", "FROM", "TO", "FOR",
  "THE", "OF", "REF", "PMT", "CR", "CREDIT", "DEBIT", "BY", "INSUFFICIENT", "FUNDS",
]);

/**
 * The first run of name-like words between separators and non-name words, or null.
 * A run counts as a name only if one of its words has 3 or more letters and is not "AND",
 * so a lone "DR" (debit marker) or a leftover "and" is not taken for a person.
 */
function remitterNameOf(upper: string): string | null {
  for (const segment of upper.split(/[/\-|:~,;()_*\\]+/)) {
    let run: string[] = [];
    const flush = (): string | null => {
      const name = normalizeName(run.join(" "));
      run = [];
      return name.split(" ").some((word) => word.length >= 3 && word !== "AND") ? name : null;
    };
    for (const token of segment.split(/\s+/).filter(Boolean)) {
      const word = token.replace(/\.+$/, "");
      const nameLike = /^[A-Z.&']+$/.test(token) && /[A-Z]/.test(token) && !RAIL_WORDS.has(word) && !NOTE_WORDS.has(word);
      if (nameLike) run.push(token);
      else {
        const name = flush();
        if (name !== null) return name;
      }
    }
    const name = flush();
    if (name !== null) return name;
  }
  return null;
}

/**
 * Reads a bank narration into the facts a matcher can use. It never throws, whatever the
 * text, and the raw text is only read. Only the first 1,000 characters are read. A name is not
 * returned unless the rail is UPI, NEFT, IMPS or RTGS, and a reference only when the rail's own
 * rule finds one. Text with no recognised rail gives rail UNKNOWN, no reference, name or
 * notes, but still any flat code, UPI address, hint or month count it contains.
 */
export function parseNarration(raw: string): ParsedNarration {
  const clean = raw.slice(0, MAX_PARSED_CHARS).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

  const vpa = clean.match(VPA_PATTERN)?.[0].toLowerCase() ?? null;
  const withoutVpa = clean.replace(VPA_PATTERN, " / ");

  const flatTokens = extractFlatTokens(withoutVpa);
  const withoutFlats = [...new Set(flatTokens.map((t) => t.matchedText))].reduce((text, matched) => text.split(matched).join(" / "), withoutVpa);

  const upper = withoutFlats.toUpperCase();
  const rail = detectRail(upper);
  const reference = referenceOf(upper, rail);
  const namedRail = rail === "UPI" || rail === "NEFT" || rail === "IMPS" || rail === "RTGS";
  const remitterName = namedRail ? remitterNameOf(upper) : null;

  const monthsMatch = /(?<![0-9])([0-9]{1,2})\s*(?:MONTHS?|MTHS?|MNTHS?|MOS?)\b/.exec(upper);
  const monthCount = monthsMatch === null ? 0 : Number(monthsMatch[1]);
  const nameWords = new Set((remitterName ?? "").split(" "));
  const notes = rail === "UNKNOWN" ? "" : upper.split(/[^A-Z0-9]+/).filter((t) => t !== "" && t !== reference && !RAIL_WORDS.has(t) && !nameWords.has(t)).join(" ");

  return {
    rail,
    reference,
    vpa,
    remitterName,
    flatTokens,
    hints: {
      maintenance: /\b(?:MAINT|MAINTENANCE|MAINTAINANCE|MAINTANANCE|MNTC|MNT)\b/.test(upper),
      rent: /\bRENT\b/.test(upper),
      advance: /\b(?:ADV|ADVANCE|ADVNC|PREPAID)\b/.test(upper),
    },
    months: monthCount >= 1 && monthCount <= 24 ? monthCount : null,
    notes,
  };
}
