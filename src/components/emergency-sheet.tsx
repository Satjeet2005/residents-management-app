"use client";

import { useState } from "react";
import { telHref } from "@/lib/phone-link";
import { t } from "@/lib/messages";
import { Button } from "./ui/button";
import { ButtonLink } from "./ui/button-link";
import { Sheet } from "./ui/sheet";

export type EmergencyNumbers = { dutyManagerPhone: string | null; emergencyServicesPhone: string | null };

function WordList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-body font-semibold">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item} className="border-b border-hairline py-3 text-body">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the Emergency sheet says (D43): call the duty manager for danger, with the two lists of what to call about and what
 * to raise as a complaint. The call links come from the society's settings: a number that is not set draws nothing, so
 * no link points nowhere. The list "Raise a complaint" is words only for now, because complaints cannot be raised yet.
 */
export function EmergencySheetContent({ numbers }: { numbers: EmergencyNumbers }) {
  const duty = telHref(numbers.dutyManagerPhone);
  const services = telHref(numbers.emergencyServicesPhone);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body font-semibold">{t("emergency.danger")}</p>
      {duty !== null ? (
        <ButtonLink href={duty} large>
          {t("emergency.callDuty")}
        </ButtonLink>
      ) : (
        <p className="text-body">{t("emergency.noDutyNumber")}</p>
      )}
      {services !== null && (
        <ButtonLink href={services} variant="outlined">
          {t("emergency.callServices")}
        </ButtonLink>
      )}
      <WordList title={t("emergency.callNow")} items={[t("emergency.callNow.fire"), t("emergency.callNow.gas"), t("emergency.callNow.lift"), t("emergency.callNow.shock"), t("emergency.callNow.hurt")]} />
      <WordList title={t("emergency.raise")} items={[t("emergency.raise.leak"), t("emergency.raise.lift"), t("emergency.raise.noise"), t("emergency.raise.parking")]} />
    </div>
  );
}

/** The Emergency control of the Home header: an outlined button (never filled) that opens the sheet. */
export function EmergencyButton({ numbers }: { numbers: EmergencyNumbers }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        {t("emergency.button")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("emergency.title")}>
        <EmergencySheetContent numbers={numbers} />
      </Sheet>
    </>
  );
}
