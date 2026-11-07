"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { Dues } from "@/domain/billing/dues";
import type { CalendarDate } from "@/domain/time/calendar";
import { type PayState, interpretPayResponse } from "@/lib/pay";
import { t } from "@/lib/messages";
import type { BankAccount } from "@/server/home/types";
import { BankTransferPanel } from "./bank-transfer-panel";
import { DuesBreakdown } from "./dues-breakdown";
import { PayChangedNotice, PayControl, PayFooter } from "./pay-control";

/**
 * Everything under the double rule of open dues: the Pay button, the link that opens the review sheet, and the sheet with
 * its sticky Pay footer. One payment state is shared by both Pay buttons. Tapping Pay posts the amount the person is
 * looking at to /api/payments (money as a decimal string): 200 goes to the checkout page, 409 AMOUNT_CHANGED shows the
 * new amount and refreshes the page behind, and any other answer is a message with Try again. Taps while loading do nothing.
 * The amount is the OLDEST open bill's (D99), not the total of every bill. `payOutlined` draws both Pay buttons outlined while a safety alert is shown (D58).
 */
export function DuesActions({ dues, asOf, flatCode, bankAccount, payOutlined = false }: { dues: Dues; asOf: CalendarDate; flatCode: string; bankAccount: BankAccount | null; payOutlined?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PayState>({ phase: "idle" });
  const busy = useRef(false);
  const oldest = dues.openBills[0];
  const shown = state.phase === "changed" ? state.amountPaise : oldest.outstandingPaise + oldest.feePaise;
  const openBills = dues.openBills.length;

  const pay = async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ phase: "loading" });
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedAmountPaise: shown.toString() }) });
      const answer = interpretPayResponse(response.status, await response.json().catch(() => null));
      if (answer.type === "GO") {
        router.push(answer.checkoutPath);
        return;
      }
      if (answer.type === "CHANGED") {
        setState({ phase: "changed", amountPaise: answer.amountPaise });
        router.refresh();
      } else {
        setState({ phase: "error", kind: answer.kind });
      }
    } catch {
      setState({ phase: "error", kind: "NETWORK" });
    }
    busy.current = false;
  };

  return (
    <>
      <PayChangedNotice state={state} />
      <PayControl amountPaise={shown} openBills={openBills} state={state} onPay={pay} outlined={payOutlined} />
      <Button variant="link" onClick={() => setOpen(true)}>
        {t("dues.seeBreakdown")}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("dues.title")}
        footer={<PayFooter amountPaise={shown} openBills={openBills} state={state} onPay={pay} outlined={payOutlined} />}
      >
        <div className="flex flex-col gap-6">
          <DuesBreakdown dues={dues} asOf={asOf} />
          <BankTransferPanel flatCode={flatCode} account={bankAccount} />
        </div>
      </Sheet>
    </>
  );
}
