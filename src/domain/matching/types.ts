import type { LateFeePolicy, LateFeeResult } from "../billing/late-fee";
import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";

/** A payment already applied to one bill. */
export type PaymentOnBill = { date: CalendarDate; amountPaise: Paise };

/** An issued bill that is not settled. Holds are ignored by the matcher (see docs/matching-design.md). */
export type OpenBill = {
  billKey: string;
  amountPaise: Paise;
  dueOn: CalendarDate;
  paymentsOnBill: readonly PaymentOnBill[];
};

/** Something a flat is known to pay from. A NAME is a payer name that is not a resident. */
export type KnownPayer = { type: "UPI_ID" | "NAME"; value: string };

/** What the matcher knows about one flat. Open bills are listed oldest first by due date. */
export type FlatContext = {
  code: string;
  residents: readonly { name: string }[];
  knownPayers: readonly KnownPayer[];
  openBills: readonly OpenBill[];
};

export type MatchSettings = {
  /** A credit at or above this needs a second approver, so it is never posted automatically. */
  approvalThresholdPaise: Paise;
  lateFeePolicy: LateFeePolicy;
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type DecisionKind = "AUTO_MATCH" | "QUEUE" | "IGNORE";
export type IgnoreKind = "DEBIT" | "INTEREST" | "BANK_CHARGE" | "NOT_MAINTENANCE";

/** Why a flat is a candidate. CODE_AMBIGUOUS and PAYER_SHARED are weak: they never identify a flat. */
export type EvidenceCode = "CODE" | "CODE_AMBIGUOUS" | "PAYER" | "PAYER_SHARED" | "NAME_EXACT" | "NAME_INITIAL" | "NAME_TRUNCATED";

export type AmountRelation = "EQUALS_DUE" | "EQUALS_PRINCIPAL" | "EQUALS_BILL" | "LESS_THAN_DUE" | "MORE_THAN_DUE" | "NO_OPEN_BILL";

export type Candidate = {
  flatCode: string;
  /** For ranking only. A decision never reads a score. */
  score: number;
  evidence: EvidenceCode[];
  /** Principal still unpaid plus the late fee on the oldest open bill, as of the row's date. */
  amountDuePaise: Paise | null;
  amountRelation: AmountRelation;
};

/** The fixed reason codes. The UI can translate by code; the text is plain English. */
export const REASON_CODES = [
  "CODE_FOUND", "CODE_AMBIGUOUS", "CODE_CONFLICT", "PAYER_KNOWN", "PAYER_SHARED",
  "NAME_EXACT", "NAME_INITIAL", "NAME_TRUNCATED",
  "AMOUNT_EQUALS_DUE", "AMOUNT_PRINCIPAL_ONLY", "AMOUNT_LESS", "AMOUNT_MORE", "NO_OPEN_BILL", "MULTIPLE_FLATS_OWE",
  "ABOVE_THRESHOLD", "HINT_CONFLICT", "DEBIT", "INTEREST", "BANK_CHARGE", "CHEQUE_RETURN", "NO_NARRATION", "NO_MATCH",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** One fact, in plain English. */
export type Reason = { code: ReasonCode; text: string };

export type PostingEntry = {
  entryType: "LATE_FEE" | "PAYMENT";
  amountPaise: Paise;
  effectiveDate: CalendarDate;
  billKey: string;
};

/** The ledger entries to write for an automatic match: an optional late fee charge, then one payment. */
export type PostingPlan = { entries: PostingEntry[] };

export type RowDecision = {
  kind: DecisionKind;
  confidence: Confidence;
  /** Set only when the decision rests on exactly one flat's identity evidence; otherwise null. */
  flatCode: string | null;
  /** Ranked, at most 5. */
  candidates: Candidate[];
  /** How many candidates there were before the list was cut to 5. */
  totalCandidates: number;
  reasons: Reason[];
  plan: PostingPlan | null;
  ignoreKind?: IgnoreKind;
};

/** The oldest open bill of a flat, worked out as of one date. */
export type OldestDue = {
  billKey: string;
  billAmountPaise: Paise;
  outstandingPaise: Paise;
  feePaise: Paise;
  duePaise: Paise;
};

/** Flat codes keyed by the amount their oldest open bill needs on one date. */
export type AmountIndex = {
  byDue: Map<Paise, string[]>;
  byPrincipal: Map<Paise, string[]>;
};

/** Memory kept by a context so the same sum is never worked out twice. It never changes an answer. */
export type MatchCaches = {
  /** Late fee results keyed by the bill's amount, due date, payments and the date. */
  fees: Map<string, LateFeeResult>;
  /** The amount index for each row date. */
  amounts: Map<CalendarDate, AmountIndex>;
};

/** Indexes built once from the society's state by buildMatchContext. */
export type MatchContext = {
  readonly settings: MatchSettings;
  readonly flats: readonly FlatContext[];
  readonly flatsByCode: ReadonlyMap<string, FlatContext>;
  /** A UPI id (trimmed, lower case) to every flat that lists it. More than one flat means the id is shared. */
  readonly flatsByUpiId: ReadonlyMap<string, readonly FlatContext[]>;
  /** A name lookup key (see nameLookupKey) to the flats with a resident or payer name word that has it. */
  readonly flatsByNameKey: ReadonlyMap<string, readonly FlatContext[]>;
  /** For each flat code, the name lookup keys of all its resident and payer-name words. */
  readonly nameKeysByFlat: ReadonlyMap<string, ReadonlySet<string>>;
  readonly caches: MatchCaches;
};
