import type { FlatBillPosition } from "../billing/dues";

/** A bill's position with the flat it belongs to. The committee report is built from these and from nothing else about money (D5, D107). */
export type ReportPosition = FlatBillPosition & { flatId: string; flatCode: string };

/** The positions that owe something: PRINCIPAL_OPEN and FEE_ONLY. A SETTLED position owes nothing. */
export const isOpen = (p: ReportPosition): boolean => p.position.kind !== "SETTLED";
