import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { type Paise, formatRupees } from "@/domain/money/money";
import { type PayState, payErrorText, payLabel } from "@/lib/pay";
import { t } from "@/lib/messages";

/** The message above the Pay button when the amount changed: it says the new amount and to tap again. */
export function PayChangedNotice({ state }: { state: PayState }) {
  return state.phase === "changed" ? <Notice>{t("pay.changed", { amount: formatRupees(state.amountPaise) })}</Notice> : null;
}

/**
 * The Pay button in every state: the label (D99), a word in its place while loading (the button ignores taps then), and
 * on an error the message with a Try again button in its place. The amount changing is shown by `PayChangedNotice`. `outlined` is for
 * while a safety alert is shown: its Call button is then the one filled control (D58, D126). `offline` is the dashed, disabled control (design state O).
 */
export function PayControl({ amountPaise, openBills, state, onPay, outlined = false, offline = false }: { amountPaise: Paise; openBills: number; state: PayState; onPay: () => void; outlined?: boolean; offline?: boolean }) {
  if (offline) return <Button size="large" variant="outlined" fullWidth disabled>{payLabel(amountPaise, openBills)}</Button>;
  if (state.phase === "error") return <BlockError message={payErrorText(state.kind)} onRetry={onPay} />;
  return (
    <Button size="large" variant={outlined ? "outlined" : "primary"} fullWidth loading={state.phase === "loading"} loadingLabel={t("pay.loading")} onClick={onPay}>
      {payLabel(amountPaise, openBills)}
    </Button>
  );
}

/** The sticky footer of the review sheet: the amount is fixed once Pay is tapped, the oldest-bill note when several bills are open (D99), then the Pay control. */
export function PayFooter({ amountPaise, openBills, state, onPay, outlined = false, offline = false }: { amountPaise: Paise; openBills: number; state: PayState; onPay: () => void; outlined?: boolean; offline?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{t("pay.fixed")}</p>
      {openBills > 1 && <p className="text-body text-ink-2">{t("pay.oldestNote")}</p>}
      <PayChangedNotice state={state} />
      <PayControl amountPaise={amountPaise} openBills={openBills} state={state} onPay={onPay} outlined={outlined} offline={offline} />
    </div>
  );
}
