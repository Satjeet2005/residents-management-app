"use client";

import { type ReactNode, useState } from "react";
import { telHref } from "@/lib/phone-link";
import { t } from "@/lib/messages";
import { ChatIcon, PhoneIcon, WarningIcon } from "./icons";
import { Button } from "./ui/button";
import { ButtonLink } from "./ui/button-link";
import { cx } from "./ui/cx";
import { Sheet } from "./ui/sheet";

export type EmergencyNumbers = { dutyManagerPhone: string | null; emergencyServicesPhone: string | null };

function WordList({ title, icon, items, strong }: { title: string; icon: ReactNode; items: readonly string[]; strong: boolean }) {
  return (
    <section className="min-w-0">
      <h3 className={cx("flex items-center gap-2 pb-2 text-body font-semibold", strong ? "border-b-2 border-ink" : "border-b border-hairline")}>
        {icon}
        {title}
      </h3>
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
 * What the Emergency sheet says (D43): call the duty manager for danger, then two columns, what to call about and what to
 * raise as a complaint, each item on its own hairline-ruled row. The call links come from the society's settings: a number
 * that is not set draws nothing, so no link points nowhere. The column "Raise a complaint" is plain text for now, because
 * complaints cannot be raised yet, and so "Not an emergency? Raise a complaint" is not drawn.
 */
export function EmergencySheetContent({ numbers }: { numbers: EmergencyNumbers }) {
  const duty = telHref(numbers.dutyManagerPhone);
  const services = telHref(numbers.emergencyServicesPhone);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">{t("emergency.danger")}</p>
      {duty !== null ? (
        <ButtonLink href={duty} large>
          <PhoneIcon />
          {t("emergency.callDuty")}
        </ButtonLink>
      ) : (
        <p className="text-body">{t("emergency.noDutyNumber")}</p>
      )}
      {services !== null && (
        <ButtonLink href={services} variant="outlined">
          <PhoneIcon />
          {t("emergency.callServices")}
        </ButtonLink>
      )}
      <div className="grid grid-cols-2 items-start gap-x-6">
        <WordList
          title={t("emergency.callNow")}
          icon={<PhoneIcon />}
          strong
          items={[t("emergency.callNow.fire"), t("emergency.callNow.gas"), t("emergency.callNow.lift"), t("emergency.callNow.shock"), t("emergency.callNow.hurt")]}
        />
        <WordList title={t("emergency.raise")} icon={<ChatIcon />} strong={false} items={[t("emergency.raise.leak"), t("emergency.raise.lift"), t("emergency.raise.noise"), t("emergency.raise.parking")]} />
      </div>
    </div>
  );
}

/** The Emergency control of the Home header: an outlined button (never filled) that opens the sheet. */
export function EmergencyButton({ numbers }: { numbers: EmergencyNumbers }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        <WarningIcon />
        {t("emergency.button")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("emergency.title")}>
        <EmergencySheetContent numbers={numbers} />
      </Sheet>
    </>
  );
}
