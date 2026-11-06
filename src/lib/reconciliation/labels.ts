import { formatRupees } from "@/domain/money/money";
import { t } from "@/lib/messages";
import type { CandidateCard, Confidence, EntryLine } from "./types";

/** "High", "Medium", "Low" or "No match": the words for how sure the matcher was. */
export function confidenceLabel(confidence: Confidence | string | null): string {
  switch (confidence) {
    case "HIGH":
      return t("recon.confidence.high");
    case "MEDIUM":
      return t("recon.confidence.medium");
    case "LOW":
      return t("recon.confidence.low");
    default:
      return t("recon.confidence.none");
  }
}

/** How the credit compares with the flat's oldest open position, in words ("₹38 less than the amount due"). */
export function relationLabel(relation: CandidateCard["amountRelation"], creditPaise: bigint, amountDuePaise: bigint | null): string {
  const difference = amountDuePaise === null ? 0n : amountDuePaise - creditPaise;
  switch (relation) {
    case "EQUALS_DUE":
      return t("recon.relation.equalsDue");
    case "EQUALS_PRINCIPAL":
      return t("recon.relation.equalsPrincipal", { amount: formatRupees(difference) });
    case "LESS_THAN_DUE":
      return t("recon.relation.less", { amount: formatRupees(difference) });
    case "MORE_THAN_DUE":
      return t("recon.relation.more");
    case "NO_OPEN_POSITION":
      return t("recon.relation.none");
  }
}

/** A stored reason as one sentence: the matcher writes them in plain English, so only the closing full stop is made sure of. */
export function reasonSentence(reason: { text: string }): string {
  const text = reason.text.trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The narration cut to `max` characters (code points) with an ellipsis; a short one is returned as it is. The full text is shown in the review. */
export function shortNarration(text: string, max = 60): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max).join("").trimEnd()}…`;
}

export function ignoreKindLabel(kind: string | null): string {
  switch (kind) {
    case "DEBIT":
      return t("recon.ignore.debit");
    case "INTEREST":
      return t("recon.ignore.interest");
    case "BANK_CHARGE":
      return t("recon.ignore.bankCharge");
    default:
      return t("recon.ignore.notMaintenance");
  }
}

export function railLabel(rail: string | null): string {
  switch (rail) {
    case "UPI":
    case "NEFT":
    case "IMPS":
    case "RTGS":
      return rail;
    case "CHEQUE_DEPOSIT":
      return t("recon.rail.chequeDeposit");
    case "CHEQUE_RETURN":
      return t("recon.rail.chequeReturn");
    case "CASH_DEPOSIT":
      return t("recon.rail.cash");
    case "BANK_CHARGE":
      return t("recon.rail.bankCharge");
    case "INTEREST":
      return t("recon.rail.interest");
    default:
      return t("recon.rail.unknown");
  }
}

export function postedByLabel(by: { kind: "AUTO" } | { kind: "MANUAL"; name: string; approvedBy?: string | null }): string {
  if (by.kind === "AUTO") return t("recon.posted.automatic");
  const manual = t("recon.posted.manual", { name: by.name });
  return by.approvedBy === undefined || by.approvedBy === null ? manual : t("recon.posted.approved", { manual, name: by.approvedBy });
}

export function entryLabel(entry: EntryLine): string {
  const amount = formatRupees(BigInt(entry.amountPaise));
  switch (entry.entryType) {
    case "LATE_FEE":
      return t("recon.entry.lateFee", { amount });
    case "PAYMENT":
      return t("recon.entry.payment", { amount });
    default:
      return t("recon.entry.other", { amount });
  }
}

/** "Match to T21-1601" or "Not a maintenance payment": what a requester asked for. */
export function requestActionLabel(action: "MATCH" | "IGNORE", flatCode: string | null): string {
  return action === "MATCH" ? t("recon.request.match", { flat: flatCode ?? "" }) : t("recon.request.ignore");
}

/** The notice for a credit at or above the threshold, naming the amount from the society setting (D116), never a number written here. */
export function thresholdNotice(thresholdPaise: bigint): string {
  return t("recon.threshold.notice", { amount: formatRupees(thresholdPaise) });
}

/** What happened to the payer's UPI id after a post with "Remember this payer's UPI id for this flat". */
export function payerNoticeText(notice: string): string {
  switch (notice) {
    case "ADDED":
      return t("recon.payer.added");
    case "ALREADY_KNOWN":
      return t("recon.payer.known");
    default:
      return t("recon.payer.otherFlat");
  }
}
