/** The shapes the reconciliation screens read. Plain data: money is a decimal string of paise, dates are texts (JSON and React serialise them as they are). */

export const LANES = ["NEEDS_YOU", "AWAITING_APPROVAL", "MATCHED", "NOT_MAINTENANCE"] as const;
export type Lane = (typeof LANES)[number];

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** What an import holds, per state, read from the database; `accounted` is the flag the database's own counts give. */
export type SummaryCounts = {
  rowsRead: number;
  autoMatched: number;
  manuallyMatched: number;
  needsYou: number;
  awaitingApproval: number;
  notMaintenance: number;
  alreadyImported: number;
  invalidRows: number;
  accounted: boolean;
};

export type ImportListEntry = {
  importId: string;
  filename: string;
  /** Calendar date in India, "2026-10-27". */
  uploadedOn: string;
  rowsRead: number;
  posted: number;
  needsYou: number;
  awaitingApproval: number;
  ignored: number;
  accounted: boolean;
};

export type WorkspaceHeader = { importId: string; filename: string; uploadedOn: string; uploadedBy: string };

export type EntryLine = { entryType: string; amountPaise: string };

export type RowCard = {
  id: string;
  rowNumber: number;
  txnDate: string;
  amountPaise: string;
  direction: "CREDIT" | "DEBIT";
  narration: string;
  state: string;
  version: number;
  confidence: Confidence | null;
  /** The matcher's best candidate flat, kept with the row. */
  bestFlat: string | null;
  /** AWAITING_APPROVAL lane. */
  request: { requestedById: string; requestedBy: string; action: "MATCH" | "IGNORE"; flatCode: string | null; reason: string; requestedOn: string } | null;
  /** Posted lane. */
  posted: { flatCode: string; by: { kind: "AUTO" } | { kind: "MANUAL"; name: string; approvedBy: string | null }; entries: EntryLine[] } | null;
  /** Not maintenance lane. */
  ignored: { ignoreKind: string | null; reason: string | null } | null;
};

export type OpenPositionCard = { billId: string; kind: "PRINCIPAL_OPEN" | "FEE_ONLY"; dueOn: string; amountDuePaise: string; principalOutstandingPaise: string; feePaise: string };

export type CandidateCard = {
  flatCode: string;
  tower: string;
  residents: string[];
  openPositions: OpenPositionCard[];
  amountRelation: "EQUALS_DUE" | "EQUALS_PRINCIPAL" | "LESS_THAN_DUE" | "MORE_THAN_DUE" | "NO_OPEN_POSITION";
};

export type ReviewData = {
  id: string;
  importId: string;
  version: number;
  state: string;
  txnDate: string;
  creditPaise: string;
  narration: string;
  rail: string | null;
  reference: string | null;
  payerName: string | null;
  upiId: string | null;
  reasons: { code: string; text: string }[];
  candidates: CandidateCard[];
  /** society_settings approval_threshold_paise, as a decimal string. */
  thresholdPaise: string;
};

export type FlatHit = { flatCode: string; tower: string; residents: string[]; openPositions: number };
