"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { t } from "@/lib/messages";
import { SECTION_IDS, type SectionId } from "@/lib/reports/sections";
import { saveSections } from "./actions";

const LABELS: Record<SectionId, () => string> = {
  money: () => t("committee.section.money"),
  owed: () => t("committee.section.owed"),
  quality: () => t("committee.section.quality"),
  complaints: () => t("committee.section.complaints"),
  bank: () => t("committee.section.bank"),
};

/**
 * "Choose sections", at the BOTTOM of the page (D178): a 48px button that opens a sheet with one checkbox per SECTION (never the headline cards). A choice is sent to
 * a server action AS SOON AS it is made, which checks the person and the request, remembers the choice in a cookie for this device and browser, and the page is
 * rendered again without the hidden sections. There is one button, "Done", which only closes the sheet. A failure says so and puts the checkbox back.
 */
export function ChooseSections({ hidden }: { hidden: readonly SectionId[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<readonly SectionId[]>(SECTION_IDS.filter((id) => !hidden.includes(id)));
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const choose = (id: SectionId, checked: boolean) => {
    const before = shown;
    const after = SECTION_IDS.filter((x) => (x === id ? checked : shown.includes(x)));
    setShown(after);
    setFailed(false);
    startTransition(async () => {
      try {
        const answer = await saveSections(SECTION_IDS.filter((x) => !after.includes(x)));
        if (!answer.ok || answer.data !== "SAVED") throw new Error("not saved");
        router.refresh();
      } catch {
        setShown(before);
        setFailed(true);
      }
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="outlined" onClick={() => setOpen(true)}>
          {t("committee.choose.button")}
        </Button>
        {hidden.length > 0 && <span className="text-body text-ink-2">{hidden.length === 1 ? t("committee.choose.hiddenOne") : t("committee.choose.hiddenMany", { n: hidden.length })}</span>}
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("committee.choose.title")}
        hideClose
        footer={
          <div className="flex flex-col gap-2">
            {failed && (
              <p role="alert" className="text-body font-semibold text-caution">
                {t("committee.choose.failed")}
              </p>
            )}
            <Button variant="outlined" onClick={() => setOpen(false)}>
              {t("committee.choose.done")}
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-body text-ink-2">{t("committee.choose.hint")}</p>
        <ul className="flex list-none flex-col gap-2 p-0">
          {SECTION_IDS.map((id) => (
            <li key={id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
                <input type="checkbox" checked={shown.includes(id)} onChange={(event) => choose(id, event.target.checked)} className="h-6 w-6 shrink-0" style={{ accentColor: "var(--color-accent)" }} />
                {LABELS[id]()}
              </label>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
