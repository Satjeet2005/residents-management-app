import { type Paise, formatRupees } from "@/domain/money/money";
import { t } from "./messages";

/** What the Pay control is doing. `changed` carries the amount the server says is today's. */
export type PayState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "changed"; amountPaise: Paise }
  | { phase: "error"; kind: PayErrorKind };

export type PayErrorKind = "UNAVAILABLE" | "NETWORK" | "SERVER" | "NO_DUES";

export type PayAnswer = { type: "GO"; checkoutPath: string } | { type: "CHANGED"; amountPaise: Paise } | { type: "ERROR"; kind: PayErrorKind };

const isAmount = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,15}$/.test(value);
/** Only an address inside this app: a path, never `//host` or a scheme. */
const isLocalPath = (value: unknown): value is string => typeof value === "string" && /^\/[^/\\]/.test(value);

/** Reads the answer of POST /api/payments. Anything unexpected is a server error: nothing is followed or shown from it. */
export function interpretPayResponse(status: number, body: unknown): PayAnswer {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status === 200 && isLocalPath(fields.checkoutPath)) return { type: "GO", checkoutPath: fields.checkoutPath };
  if (status === 409 && fields.error === "AMOUNT_CHANGED" && isAmount(fields.amountPaise)) return { type: "CHANGED", amountPaise: BigInt(fields.amountPaise) };
  if (status === 409 && fields.error === "NO_DUES") return { type: "ERROR", kind: "NO_DUES" };
  if (status === 503) return { type: "ERROR", kind: "UNAVAILABLE" };
  return { type: "ERROR", kind: "SERVER" };
}

/** "Pay ₹6,468", or "Pay oldest bill ₹6,468" when more than one bill is open (D99): the amount is the oldest bill's, not the total. */
export function payLabel(amountPaise: Paise, openBills: number): string {
  const amount = formatRupees(amountPaise);
  return openBills > 1 ? t("pay.buttonOldest", { amount }) : t("pay.button", { amount });
}

export function payErrorText(kind: PayErrorKind): string {
  switch (kind) {
    case "UNAVAILABLE":
      return t("pay.error.unavailable");
    case "NETWORK":
      return t("pay.error.network");
    case "NO_DUES":
      return t("pay.error.noDues");
    case "SERVER":
      return t("pay.error.server");
  }
}
