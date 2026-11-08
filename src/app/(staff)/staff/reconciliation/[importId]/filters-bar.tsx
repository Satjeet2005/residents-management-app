"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Sheet } from "@/components/ui/sheet";
import { AMOUNTS, DEFAULT_FILTERS, REASONS, type RowFilters, SORTS, activeFilters, amountLabel, narrowsRows, reasonApplies, reasonLabel, sortLabel } from "@/lib/reconciliation/filters";
import { t } from "@/lib/messages";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { Lane } from "@/lib/reconciliation/types";
import type { RowFacets } from "@/server/statements/review";

const OPTION = "flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-1";

/** One group of radio options, each on its own 48px row; the group is a fieldset so that it has a name and can be switched off as a whole. */
function Group<T extends string>({ title, name, value, options, onChange, disabled = false, note }: { title: string; name: string; value: T; options: { value: T; label: string; count?: number }[]; onChange: (value: T) => void; disabled?: boolean; note?: string }) {
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="pb-1 text-body font-semibold">{title}</legend>
      {note !== undefined && <p className="text-caption text-ink-2">{note}</p>}
      {options.map((option) => (
        <label key={option.value} className={cx(OPTION, disabled && "cursor-not-allowed text-ink-2")}>
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="h-5 w-5 shrink-0 accent-accent" />
          <span className="min-w-0 flex-1 break-words text-body">{option.label}</span>
          {option.count !== undefined && <span className="tnum text-caption text-ink-2">{option.count}</span>}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The filter row of a lane (D192): "Showing x of y rows" with a Filters button that shows how many choices are active, the active choices as removable chips, and the
 * sheet (the shared Sheet, so it locks the page scroll and gives focus back to the button) with the three radio groups, Apply (the only filled control) and Reset.
 * Everything is in the address, so a reload keeps it; Apply and Reset change the address and close the sheet.
 */
export function FiltersBar({ importId, lane, filters, facets, thresholdPaise, shown }: { importId: string; lane: Lane; filters: RowFilters; facets: RowFacets; thresholdPaise: string; shown: number }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const threshold = BigInt(thresholdPaise);
  const chips = activeFilters(filters, lane, threshold);
  const reasons = reasonApplies(lane);
  const go = (next: RowFilters) => {
    setOpen(false);
    router.push(workspaceHref({ importId, lane, filters: next }));
  };
  const apply = (event: FormEvent) => {
    event.preventDefault();
    go(draft);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="tnum text-caption text-ink-2">{narrowsRows(filters, lane) ? t("recon.filter.showingFiltered", { shown, total: facets.filteredTotal }) : t("recon.filter.showing", { shown, total: facets.filteredTotal })}</p>
        <Button
          variant="outlined"
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(filters);
            setOpen(true);
          }}
        >
          {chips.length === 0 ? t("recon.filter.button") : t("recon.filter.buttonCount", { n: chips.length })}
        </Button>
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Button variant="outlined" aria-label={t("recon.filter.chip", { name: chip.name })} onClick={() => go({ ...filters, [chip.key]: DEFAULT_FILTERS[chip.key] })}>
                {chip.name}
                <CloseIcon size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("recon.filter.title")}
        footer={
          <div className="flex gap-2">
            <Button type="submit" form={formId}>
              {t("recon.filter.apply")}
            </Button>
            <Button variant="outlined" onClick={() => go(DEFAULT_FILTERS)}>
              {t("recon.filter.reset")}
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={apply} className="flex flex-col gap-4">
          <Group title={t("recon.filter.sortTitle")} name="sort" value={draft.sort} options={SORTS.map((value) => ({ value, label: sortLabel(value) }))} onChange={(sort) => setDraft({ ...draft, sort })} />
          <Group title={t("recon.filter.amountTitle")} name="amount" value={draft.amount} options={AMOUNTS.map((value) => ({ value, label: amountLabel(value, threshold) }))} onChange={(amount) => setDraft({ ...draft, amount })} />
          <Group
            title={t("recon.filter.reasonTitle")}
            name="reason"
            value={reasons ? draft.reason : "any"}
            options={REASONS.map((value) => ({ value, label: reasonLabel(value), count: reasons ? facets.reasonCounts[value] : undefined }))}
            onChange={(reason) => setDraft({ ...draft, reason })}
            disabled={!reasons}
            note={reasons ? t("recon.filter.reasonNote") : t("recon.filter.reasonOff")}
          />
        </form>
      </Sheet>
    </div>
  );
}
