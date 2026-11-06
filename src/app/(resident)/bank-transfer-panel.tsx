"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/messages";
import type { BankAccount } from "@/server/home/types";

type Copy = "idle" | "copied" | "failed";

/**
 * "Paying by bank transfer instead?": the payment note (the flat code) in a chip, a button that copies it with a visible
 * "Copied", what to do with it, and the society's account as given by the setting. The account lines are left out when
 * the setting is missing. The copy needs the browser's clipboard; if it is refused, the screen says so instead of "Copied".
 */
export function BankTransferPanel({ flatCode, account }: { flatCode: string; account: BankAccount | null }) {
  const [copy, setCopy] = useState<Copy>("idle");
  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(flatCode);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };
  return (
    <section aria-labelledby="transfer-title" className="flex flex-col gap-3">
      <h3 id="transfer-title" className="text-body font-semibold">
        {t("transfer.title")}
      </h3>
      <div className="flex items-center gap-2">
        <span className="tnum inline-flex min-h-12 items-center rounded-control bg-paper-2 px-4 text-body font-semibold">{flatCode}</span>
        <Button variant="outlined" onClick={copyNote}>
          {t("transfer.copy")}
        </Button>
      </div>
      <p role="status" className={copy === "failed" ? "text-body font-semibold text-caution" : "text-body font-semibold text-accent"}>
        {copy === "copied" ? t("transfer.copied") : copy === "failed" ? t("transfer.copyFailed") : null}
      </p>
      <p className="text-body text-ink-2">{t("transfer.hint")}</p>
      {account !== null && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
          <dt className="text-ink-2">{t("transfer.accountName")}</dt>
          <dd className="min-w-0 break-words">{account.name}</dd>
          <dt className="text-ink-2">{t("transfer.accountNumber")}</dt>
          <dd className="tnum">{account.number}</dd>
          <dt className="text-ink-2">{t("transfer.ifsc")}</dt>
          <dd className="tnum">{account.ifsc}</dd>
        </dl>
      )}
    </section>
  );
}
