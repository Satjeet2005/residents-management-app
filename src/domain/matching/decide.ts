import { formatRupees } from "../money/money";
import { evidenceReason, amountReason, FIXED_REASONS, reason, uniqueReasons } from "./reasons";
import { gatherEvidence, hasIdentity, type Evidence } from "./evidence";
import type { ParsedNarration } from "./narration";
import type { StatementRow } from "./csv";
import { planPayment } from "./plan";
import type { Candidate, FlatContext, IgnoreKind, MatchContext, Reason, RowDecision } from "./types";

/** The fields of a statement row that the matcher reads. */
export type RowInput = Pick<StatementRow, "txnDate" | "narrationRaw" | "creditPaise" | "debitPaise">;

export const MAX_LISTED_CANDIDATES = 5;

type RuleInput = {
  context: MatchContext;
  row: RowInput;
  parsed: ParsedNarration;
  /** The evidence of the row. It is worked out on first use, so rules that ignore a row never pay for it. */
  evidence: () => Evidence;
};

export type Rule = { id: string; title: string; decide: (input: RuleInput) => RowDecision | null };

function decision(fields: Partial<RowDecision> & Pick<RowDecision, "kind" | "confidence" | "reasons">): RowDecision {
  return { flatCode: null, candidates: [], totalCandidates: 0, plan: null, ...fields };
}

function listed(candidates: readonly Candidate[]): Pick<RowDecision, "candidates" | "totalCandidates"> {
  return { candidates: candidates.slice(0, MAX_LISTED_CANDIDATES), totalCandidates: candidates.length };
}

const ignore = (ignoreKind: IgnoreKind, reasons: Reason[]): RowDecision => decision({ kind: "IGNORE", confidence: "NONE", reasons, ignoreKind });

// ---- Rules that need only the row: M0 (no amount), M1, M2, M3 ----

const M0: Rule = {
  id: "M0",
  title: "A row with no amount on either side is ignored",
  decide: ({ row }) => (row.creditPaise <= 0n && row.debitPaise <= 0n ? ignore("NOT_MAINTENANCE", [FIXED_REASONS.noAmount]) : null),
};

const M1: Rule = {
  id: "M1",
  title: "A debit is ignored, except a returned cheque, which a person must handle",
  decide: ({ row, parsed }) => {
    if (row.debitPaise <= 0n) return null;
    if (parsed.rail === "CHEQUE_RETURN") return decision({ kind: "QUEUE", confidence: "NONE", reasons: [FIXED_REASONS.chequeReturnDebit] });
    const extra = parsed.rail === "INTEREST" ? [FIXED_REASONS.interest] : parsed.rail === "BANK_CHARGE" ? [FIXED_REASONS.bankCharge] : [];
    return ignore("DEBIT", [FIXED_REASONS.debit, ...extra]);
  },
};

const M2: Rule = {
  id: "M2",
  title: "Interest and bank charges are ignored",
  decide: ({ parsed }) => {
    if (parsed.rail === "INTEREST") return ignore("INTEREST", [FIXED_REASONS.interest]);
    if (parsed.rail === "BANK_CHARGE") return ignore("BANK_CHARGE", [FIXED_REASONS.bankCharge]);
    return null;
  },
};

const M3: Rule = {
  id: "M3",
  title: "A credit with no narration goes to a person, with no candidates",
  decide: ({ row }) => (row.narrationRaw.trim() === "" ? decision({ kind: "QUEUE", confidence: "NONE", reasons: [FIXED_REASONS.noNarration] }) : null),
};

// ---- M4: the conditions that must ALL hold for an automatic match (M8 is one of them) ----

type Facts = { evidence: Evidence; identity: Candidate[]; primary: Candidate | null };

type AutoCondition = {
  id: string;
  title: string;
  holds: (facts: Facts, input: RuleInput) => boolean;
  /** What to tell a person when the condition fails. */
  whyNot: (facts: Facts, input: RuleInput) => Reason[];
};

export const AUTO_CONDITIONS: readonly AutoCondition[] = [
  {
    id: "M4a",
    title: "Exactly one flat has CODE or PAYER evidence, and no other flat has",
    holds: ({ identity }) => identity.length === 1,
    whyNot: () => [],
  },
  {
    id: "M4b",
    title: "The narration has no second, different flat code and no ambiguous flat token",
    holds: ({ evidence }) => evidence.codes.length <= 1 && !evidence.hasAmbiguousToken,
    whyNot: ({ evidence }) => [...(evidence.codes.length > 1 ? [FIXED_REASONS.manyCodes] : []), ...(evidence.hasAmbiguousToken ? [FIXED_REASONS.codeAmbiguous] : [])],
  },
  {
    id: "M4c",
    title: "The UPI id is not listed by more than one flat (M9)",
    holds: ({ evidence }) => evidence.vpaFlats.length <= 1,
    whyNot: () => [FIXED_REASONS.payerShared],
  },
  {
    id: "M4d",
    title: "A flat code and a known UPI id, if both are present, name the same flat",
    holds: ({ evidence }) => evidence.payerFlat === null || evidence.codes.length === 0 || evidence.codes.includes(evidence.payerFlat.code),
    whyNot: () => [FIXED_REASONS.codeFlatAndUpiDiffer],
  },
  {
    id: "M4e",
    title: "The flat has an open bill and the credit equals the amount due on its OLDEST open bill",
    holds: ({ primary }) => primary !== null && primary.amountRelation === "EQUALS_DUE",
    whyNot: ({ primary }, { row }) => (primary === null ? [] : [amountReason(primary, row.creditPaise)]),
  },
  {
    id: "M8",
    title: "The credit is below the approval threshold (M4 f)",
    holds: (_facts, { row, context }) => row.creditPaise < context.settings.approvalThresholdPaise,
    whyNot: () => [FIXED_REASONS.aboveThreshold],
  },
  {
    id: "M4g",
    title: "The rail is not CHEQUE_RETURN",
    holds: (_facts, { parsed }) => parsed.rail !== "CHEQUE_RETURN",
    whyNot: () => [FIXED_REASONS.chequeReturnCredit],
  },
];

function factsOf(input: RuleInput): Facts {
  const evidence = input.evidence();
  const identity = evidence.candidates.filter(hasIdentity);
  return { evidence, identity, primary: identity.length === 1 ? identity[0] : null };
}

function evidenceReasons(candidate: Candidate, parsed: ParsedNarration): Reason[] {
  return candidate.evidence.map((code) => evidenceReason(code, candidate.flatCode, parsed.vpa));
}

const M4: Rule = {
  id: "M4",
  title: "Automatic match: every condition M4a to M4g and M8 holds",
  decide: (input) => {
    const facts = factsOf(input);
    const { primary } = facts;
    if (primary === null || !AUTO_CONDITIONS.every((condition) => condition.holds(facts, input))) return null;
    return decision({
      kind: "AUTO_MATCH",
      confidence: "HIGH",
      flatCode: primary.flatCode,
      plan: planPayment(input.context.flatsByCode.get(primary.flatCode) as FlatContext, input.row.creditPaise, input.row.txnDate, input.context.settings),
      ...listed(facts.evidence.candidates),
      reasons: uniqueReasons([...evidenceReasons(primary, input.parsed), amountReason(primary, input.row.creditPaise)]),
    });
  },
};

const M5: Rule = {
  id: "M5",
  title: "Identity evidence but not enough for an automatic match: a person decides, medium confidence",
  decide: (input) => {
    const facts = factsOf(input);
    if (facts.identity.length === 0) return null;
    const failing = AUTO_CONDITIONS.filter((condition) => !condition.holds(facts, input)).flatMap((condition) => condition.whyNot(facts, input));
    const reasons = [
      ...facts.identity.flatMap((candidate) => evidenceReasons(candidate, input.parsed)),
      ...(facts.primary === null ? [] : [amountReason(facts.primary, input.row.creditPaise)]),
      ...failing,
    ];
    return decision({
      kind: "QUEUE",
      confidence: "MEDIUM",
      flatCode: facts.primary === null ? null : facts.primary.flatCode,
      ...listed(facts.evidence.candidates),
      reasons: uniqueReasons(reasons),
    });
  },
};

const isAmountOnly = (candidate: Candidate): boolean => candidate.evidence.length === 0;

/** What the amount says about a set of flats, as one reason. */
function amountSetReason(candidates: readonly Candidate[], creditPaise: bigint): Reason[] {
  const owing = candidates.filter((c) => c.amountRelation === "EQUALS_DUE" || c.amountRelation === "EQUALS_PRINCIPAL");
  if (owing.length > 1) return [reason("MULTIPLE_FLATS_OWE", `${owing.length} flats owe ${formatRupees(creditPaise)}`)];
  if (owing.length === 1) {
    const [only] = owing;
    const note = isAmountOnly(only) ? ". An amount alone does not say who paid" : "";
    return [{ ...amountReason(only, creditPaise), text: `${amountReason(only, creditPaise).text}${note}` }];
  }
  return [];
}

const M6: Rule = {
  id: "M6",
  title: "No identity evidence, but names or amounts fit some flats: a person decides, low confidence",
  decide: (input) => {
    const facts = factsOf(input);
    const { candidates } = facts.evidence;
    if (facts.identity.length > 0 || candidates.length === 0) return null;
    const top = candidates[0];
    const failing = AUTO_CONDITIONS.filter((c) => c.id !== "M4a" && c.id !== "M4e" && !c.holds(facts, input)).flatMap((c) => c.whyNot(facts, input));
    const amountReasons = amountSetReason(candidates, input.row.creditPaise);
    const reasons = [
      ...(isAmountOnly(top) ? [] : [...evidenceReasons(top, input.parsed), ...(amountReasons.length === 0 ? [amountReason(top, input.row.creditPaise)] : [])]),
      ...amountReasons,
      ...failing,
    ];
    return decision({ kind: "QUEUE", confidence: "LOW", ...listed(candidates), reasons: uniqueReasons(reasons) });
  },
};

const M7: Rule = {
  id: "M7",
  title: "Nothing fits: a person decides, no confidence",
  decide: (input) => {
    const { codes, codeFlats } = input.evidence();
    const notes = codes.filter((code) => !codeFlats.some((flat) => flat.code === code)).map((code) => reason("NO_MATCH", `Flat code ${code} is not a flat in this society`));
    return decision({ kind: "QUEUE", confidence: "NONE", reasons: [FIXED_REASONS.noMatch, ...notes] });
  },
};

/** The rules in the order they are tried. The first that gives a decision wins. */
export const DECISION_RULES: readonly Rule[] = [M0, M1, M2, M3, M4, M5, M6, M7];

/**
 * Decides one statement row: AUTO_MATCH, QUEUE or IGNORE. The first rule in DECISION_RULES that
 * applies decides, and no score is read. When in doubt the answer is QUEUE.
 */
export function matchRow(context: MatchContext, row: RowInput, parsed: ParsedNarration): RowDecision {
  if (row.creditPaise < 0n || row.debitPaise < 0n) throw new RangeError("Row amounts must not be negative");
  let kept: Evidence | undefined;
  const input: RuleInput = {
    context,
    row,
    parsed,
    evidence: () => (kept ??= gatherEvidence(context, row, parsed)),
  };
  for (const rule of DECISION_RULES) {
    const result = rule.decide(input);
    if (result !== null) return result;
  }
  throw new Error("No decision rule applied");
}
