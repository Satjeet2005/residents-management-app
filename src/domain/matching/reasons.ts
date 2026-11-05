import { formatRupees, type Paise } from "../money/money";
import type { Candidate, EvidenceCode, Reason, ReasonCode } from "./types";

export const reason = (code: ReasonCode, text: string): Reason => ({ code, text });

/** Texts that do not depend on the row. The words are fixed so a person always reads the same sentence. */
export const FIXED_REASONS = {
  payerShared: reason("PAYER_SHARED", "UPI id is registered to more than one flat"),
  codeAmbiguous: reason("CODE_AMBIGUOUS", "A flat reference in the narration could mean more than one flat"),
  codeFlatAndUpiDiffer: reason("CODE_CONFLICT", "Flat code and UPI id point to different flats"),
  manyCodes: reason("CODE_CONFLICT", "The narration names more than one flat code"),
  aboveThreshold: reason("ABOVE_THRESHOLD", "Needs a second approver when posted"),
  hintConflict: reason("HINT_CONFLICT", "The note says advance or several months, but the amount equals one bill."),
  laterPayment: reason("LATER_PAYMENT", "This bill already has a payment dated after this row, so a person must check the order."),
  chequeReturnDebit: reason("CHEQUE_RETURN", "Cheque returned: a person must reverse the matching payment"),
  chequeReturnCredit: reason("CHEQUE_RETURN", "Narration says a cheque was returned: a person must check it"),
  debit: reason("DEBIT", "Money went out of the account, so it is not a maintenance payment"),
  interest: reason("INTEREST", "Interest paid by the bank, not a maintenance payment"),
  bankCharge: reason("BANK_CHARGE", "A bank charge, not a maintenance payment"),
  noNarration: reason("NO_NARRATION", "The row has no narration, so nothing says who paid"),
  noMatch: reason("NO_MATCH", "No flat found. May not be a maintenance payment."),
  noAmount: reason("NO_MATCH", "The row has no amount to match"),
  noOpenBill: reason("NO_OPEN_BILL", "No open bill on this flat"),
  amountLess: reason("AMOUNT_LESS", "Amount is less than the amount due"),
  amountMore: reason("AMOUNT_MORE", "More than the amount due: possible advance or several months"),
  amountEqualsDue: reason("AMOUNT_EQUALS_DUE", "Amount equals the amount due on the oldest open bill"),
} as const;

/** What a candidate's evidence says, one fact per code. PAYER_SHARED and CODE_AMBIGUOUS read the same for every flat. */
export function evidenceReason(code: EvidenceCode, flatCode: string, vpa: string | null): Reason {
  switch (code) {
    case "CODE":
      return reason("CODE_FOUND", `Flat code ${flatCode} is in the narration`);
    case "PAYER":
      return reason("PAYER_KNOWN", `UPI id ${vpa ?? ""} is known to be used by flat ${flatCode}`);
    case "PAYER_SHARED":
      return FIXED_REASONS.payerShared;
    case "CODE_AMBIGUOUS":
      return FIXED_REASONS.codeAmbiguous;
    case "NAME_EXACT":
      return reason("NAME_EXACT", `The name on the payment is the name of a resident of ${flatCode}`);
    case "NAME_INITIAL":
      return reason("NAME_INITIAL", `The name on the payment matches a resident of ${flatCode} except for an initial`);
    case "NAME_TRUNCATED":
      return reason("NAME_TRUNCATED", `The name on the payment matches a resident of ${flatCode} but is cut short`);
  }
}

/** How the credit compares with the flat's oldest open bill, as one fact. */
export function amountReason(candidate: Candidate, creditPaise: Paise): Reason {
  const due = candidate.amountDuePaise;
  switch (candidate.amountRelation) {
    case "NO_OPEN_BILL":
      return FIXED_REASONS.noOpenBill;
    case "EQUALS_DUE":
      return FIXED_REASONS.amountEqualsDue;
    case "EQUALS_PRINCIPAL":
      return reason("AMOUNT_PRINCIPAL_ONLY", `Amount equals the unpaid bill but not the late fee: ${formatRupees((due as Paise) - creditPaise)} would remain`);
    case "LESS_THAN_DUE":
      return FIXED_REASONS.amountLess;
    case "MORE_THAN_DUE":
      return FIXED_REASONS.amountMore;
    case "EQUALS_BILL":
      return creditPaise > (due as Paise) ? FIXED_REASONS.amountMore : FIXED_REASONS.amountLess;
  }
}

/** The same reason is listed once. */
export function uniqueReasons(reasons: readonly Reason[]): Reason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    const key = `${r.code}|${r.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
