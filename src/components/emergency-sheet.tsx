"use client";

import { useState } from "react";
import { formatPhone, telHref } from "@/lib/phone-link";
import { t } from "@/lib/messages";
import { PhoneIcon, WarningIcon } from "./icons";
import { Button } from "./ui/button";
import { ButtonLink } from "./ui/button-link";
import { Sheet } from "./ui/sheet";

export type EmergencyNumbers = { dutyManagerPhone: string | null; emergencyServicesPhone: string | null };

const NEW_COMPLAINT = "/complaints/new";

/**
 * What the Emergency sheet says (D43, D185): call first. One sentence, the only filled control (Call duty manager, with the number written under it so it can be read
 * out), one sentence of examples, the emergency services number as plain text when the society has set one, then "Not an emergency?" with an outlined link to the
 * complaint form. The numbers come from the society's settings: a duty manager number that is not set draws no button, so no link points nowhere.
 */
export function EmergencySheetContent({ numbers }: { numbers: EmergencyNumbers }) {
  const duty = telHref(numbers.dutyManagerPhone);
  const dutyText = formatPhone(numbers.dutyManagerPhone);
  const servicesText = formatPhone(numbers.emergencyServicesPhone);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">{t("emergency.danger")}</p>
      {duty !== null ? (
        <div className="flex flex-col gap-2">
          <ButtonLink href={duty} large>
            <PhoneIcon />
            {t("emergency.callDuty")}
          </ButtonLink>
          <p className="text-center text-body tnum">{dutyText}</p>
        </div>
      ) : (
        <p className="text-body">{t("emergency.noDutyNumber")}</p>
      )}
      <p className="text-body text-ink-2">{t("emergency.examples")}</p>
      {servicesText !== null && <p className="text-body tnum">{t("emergency.services", { number: servicesText })}</p>}
      <div className="flex flex-col gap-2 border-t border-hairline pt-4">
        <h3 className="text-body font-semibold">{t("emergency.notEmergency")}</h3>
        <ButtonLink href={NEW_COMPLAINT} variant="outlined">
          {t("emergency.raise")}
        </ButtonLink>
        <p className="text-caption text-ink-2">{t("emergency.raiseExamples")}</p>
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
      <Sheet open={open} onClose={() => setOpen(false)} title={t("emergency.title")} fromTop>
        <EmergencySheetContent numbers={numbers} />
      </Sheet>
    </>
  );
}
