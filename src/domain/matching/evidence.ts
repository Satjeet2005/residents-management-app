import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import { amountIndexFor, amountRelation, oldestDue } from "./amounts";
import { normaliseUpiId } from "./context";
import { nameLookupKey, nameMatchStrength, nameWords } from "./names";
import type { ParsedNarration } from "./narration";
import type { AmountRelation, Candidate, EvidenceCode, FlatContext, MatchContext } from "./types";

/**
 * Scores only rank candidates for the person reading the queue. A decision is made by the rules in
 * rules.ts and never reads a score. CODE_AMBIGUOUS and PAYER_SHARED are not in the brief's list; they
 * are ranked between a name and a certain identity.
 */
export const EVIDENCE_SCORES: Readonly<Record<EvidenceCode, number>> = {
  CODE: 100,
  PAYER: 90,
  CODE_AMBIGUOUS: 30,
  PAYER_SHARED: 30,
  NAME_EXACT: 30,
  NAME_INITIAL: 20,
  NAME_TRUNCATED: 15,
};

export const AMOUNT_SCORES: Readonly<Record<AmountRelation, number>> = {
  EQUALS_DUE: 40,
  EQUALS_BILL: 25,
  EQUALS_PRINCIPAL: 25,
  LESS_THAN_DUE: 5,
  MORE_THAN_DUE: 5,
  NO_OPEN_BILL: -20,
};

/** The facts of a row that the evidence step reads. */
export type RowFacts = { txnDate: CalendarDate; creditPaise: Paise };

export type Evidence = {
  /** The distinct flat codes the narration names without doubt, in the order they appear. */
  codes: string[];
  /** True when some flat token in the narration can be read as more than one flat. */
  hasAmbiguousToken: boolean;
  /** Flats that exist in the society and are named by a certain code. */
  codeFlats: FlatContext[];
  /** Every flat that lists the narration's UPI id. One flat means a payer; more than one means shared. */
  vpaFlats: FlatContext[];
  /** The one flat that lists the UPI id, or null when none or several do. */
  payerFlat: FlatContext | null;
  /** All candidates, ranked best first. The decision cuts the list to 5. */
  candidates: Candidate[];
};

const IDENTITY: ReadonlySet<EvidenceCode> = new Set<EvidenceCode>(["CODE", "PAYER"]);

/** True when a candidate has CODE or PAYER evidence: a certain code, or a UPI id that only this flat lists. */
export const hasIdentity = (candidate: Candidate): boolean => candidate.evidence.some((e) => IDENTITY.has(e));

const NAME_EVIDENCE: Readonly<Record<"EXACT" | "INITIAL" | "TRUNCATED", EvidenceCode>> = {
  EXACT: "NAME_EXACT",
  INITIAL: "NAME_INITIAL",
  TRUNCATED: "NAME_TRUNCATED",
};

/** The best name evidence of a flat for a remitter, or null. */
function nameEvidence(remitter: string, flat: FlatContext): EvidenceCode | null {
  let best: EvidenceCode | null = null;
  const names = [...flat.residents.map((r) => r.name), ...flat.knownPayers.filter((p) => p.type === "NAME").map((p) => p.value)];
  for (const name of names) {
    const strength = nameMatchStrength(remitter, name);
    if (strength === "NONE") continue;
    const code = NAME_EVIDENCE[strength];
    if (best === null || EVIDENCE_SCORES[code] > EVIDENCE_SCORES[best]) best = code;
  }
  return best;
}

/**
 * Flats with a name word under every lookup key of the remitter's words of 2 or more letters,
 * checked with nameMatchStrength. Every such word must pair with a word of the same key, so a flat
 * missing one key cannot match. A remitter with no such word finds nothing.
 */
function nameFlats(context: MatchContext, remitter: string): Map<string, EvidenceCode> {
  const found = new Map<string, EvidenceCode>();
  const keys = [...new Set(nameWords(remitter).filter((w) => w.length >= 2).map(nameLookupKey))];
  if (keys.length === 0) return found;
  const buckets = keys.map((key) => context.flatsByNameKey.get(key) ?? []).sort((a, b) => a.length - b.length);
  for (const flat of buckets[0]) {
    const flatKeys = context.nameKeysByFlat.get(flat.code);
    if (flatKeys === undefined || !keys.every((key) => flatKeys.has(key))) continue;
    const evidence = nameEvidence(remitter, flat);
    if (evidence !== null) found.set(flat.code, evidence);
  }
  return found;
}

function candidateOf(context: MatchContext, flat: FlatContext, evidence: EvidenceCode[], row: RowFacts): Candidate {
  const due = oldestDue(flat.openBills, row.txnDate, context.settings.lateFeePolicy, context.caches.fees);
  const relation = amountRelation(row.creditPaise, flat.openBills, due);
  const weakScore = Math.max(0, ...evidence.filter((e) => !IDENTITY.has(e)).map((e) => EVIDENCE_SCORES[e]));
  const identityScore = evidence.filter((e) => IDENTITY.has(e)).reduce((sum, e) => sum + EVIDENCE_SCORES[e], 0);
  return {
    flatCode: flat.code,
    score: identityScore + weakScore + AMOUNT_SCORES[relation],
    evidence,
    amountDuePaise: due === null ? null : due.duePaise,
    amountRelation: relation,
  };
}

/** Higher score first; on a tie a candidate with identity evidence comes first, then the lower flat code. */
const byRank = (a: Candidate, b: Candidate): number =>
  b.score - a.score || Number(hasIdentity(b)) - Number(hasIdentity(a)) || (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0);

/**
 * Gathers what a row says about each flat, then lists the candidates.
 *
 * Candidates are: flats named by a certain code or a UPI id that only one flat lists; flats with a
 * shared UPI id, an uncertain flat token or a matching name; and, only when no flat has a certain code
 * or a sole UPI id, every flat whose oldest open bill needs exactly this amount (due, or principal
 * without the fee). Every candidate is counted; the list is ranked by score, then by flat code.
 */
export function gatherEvidence(context: MatchContext, row: RowFacts, parsed: ParsedNarration): Evidence {
  const unambiguous = parsed.flatTokens.filter((t) => !t.ambiguous);
  const codes = [...new Set(unambiguous.map((t) => t.code))];
  const hasAmbiguousToken = parsed.flatTokens.some((t) => t.ambiguous);
  const codeFlats = codes.flatMap((code) => context.flatsByCode.get(code) ?? []);
  const vpaFlats = parsed.vpa === null ? [] : [...(context.flatsByUpiId.get(normaliseUpiId(parsed.vpa)) ?? [])];
  const payerFlat = vpaFlats.length === 1 ? vpaFlats[0] : null;

  const evidenceOf = new Map<string, EvidenceCode[]>();
  const add = (flat: FlatContext, code: EvidenceCode): void => {
    const list = evidenceOf.get(flat.code);
    if (list === undefined) evidenceOf.set(flat.code, [code]);
    else if (!list.includes(code)) list.push(code);
  };
  for (const flat of codeFlats) add(flat, "CODE");
  if (payerFlat !== null) add(payerFlat, "PAYER");
  if (vpaFlats.length > 1) for (const flat of vpaFlats) add(flat, "PAYER_SHARED");
  for (const token of parsed.flatTokens.filter((t) => t.ambiguous)) {
    const flat = context.flatsByCode.get(token.code);
    if (flat !== undefined) add(flat, "CODE_AMBIGUOUS");
  }
  if (parsed.remitterName !== null) {
    for (const [code, evidence] of nameFlats(context, parsed.remitterName)) add(context.flatsByCode.get(code) as FlatContext, evidence);
  }

  const candidates = [...evidenceOf].map(([code, evidence]) => candidateOf(context, context.flatsByCode.get(code) as FlatContext, evidence, row));
  if (codeFlats.length === 0 && payerFlat === null) {
    const index = amountIndexFor(context, row.txnDate);
    const owing = new Set([...(index.byDue.get(row.creditPaise) ?? []), ...(index.byPrincipal.get(row.creditPaise) ?? [])]);
    for (const code of owing) {
      if (!evidenceOf.has(code)) candidates.push(candidateOf(context, context.flatsByCode.get(code) as FlatContext, [], row));
    }
  }
  candidates.sort(byRank);
  return { codes, hasAmbiguousToken, codeFlats, vpaFlats, payerFlat, candidates };
}
