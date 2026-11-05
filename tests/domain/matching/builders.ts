import type { FlatContext, KnownPayer, OpenBill, PaymentOnBill } from "@/domain/matching/types";

/** A bill open since `dueOn`, with no payments unless given. */
export function bill(billKey: string, amountPaise: bigint, dueOn: string, paymentsOnBill: PaymentOnBill[] = []): OpenBill {
  return { billKey, amountPaise, dueOn, paymentsOnBill };
}

export type FlatOptions = { residents?: string[]; upi?: string[]; payerNames?: string[]; bills?: OpenBill[] };

/** A hand-built flat: only what a test names is set. */
export function flat(code: string, options: FlatOptions = {}): FlatContext {
  const knownPayers: KnownPayer[] = [
    ...(options.upi ?? []).map((value): KnownPayer => ({ type: "UPI_ID", value })),
    ...(options.payerNames ?? []).map((value): KnownPayer => ({ type: "NAME", value })),
  ];
  return { code, residents: (options.residents ?? []).map((name) => ({ name })), knownPayers, openBills: options.bills ?? [] };
}
