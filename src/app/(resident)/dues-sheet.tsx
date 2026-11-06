"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { Dues } from "@/domain/billing/dues";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { DuesBreakdown } from "./dues-breakdown";

/** The link that opens the breakdown sheet. There is no Pay control here yet (it arrives with the payment task). */
export function DuesSheetButton({ dues, asOf }: { dues: Dues; asOf: CalendarDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="link" onClick={() => setOpen(true)}>
        {t("dues.seeBreakdown")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("dues.title")}>
        <DuesBreakdown dues={dues} asOf={asOf} />
      </Sheet>
    </>
  );
}
