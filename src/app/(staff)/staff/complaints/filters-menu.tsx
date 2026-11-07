"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { BoardView } from "@/domain/complaints/board-views";
import { CATEGORY_CODES, URGENCIES, type Urgency } from "@/domain/complaints/taxonomy";
import { t } from "@/lib/messages";
import { type AssigneeFilter, type BoardFilters, NO_FILTERS, boardHref, flatCodePrefix, hasFilters } from "@/lib/staff-complaints/board-query";
import { categoryName, urgencyLabel } from "@/lib/staff-complaints/labels";

const FIELD = "min-h-12 w-full rounded-control border-2 border-control bg-paper px-3 text-body";

/**
 * The "Filters" button and its sheet: category, assignee, urgency and a flat-code search, with Apply and Reset. Apply and Reset change the address (the board is read
 * on the server) and close the sheet. A flat code that cannot be read as a prefix is ignored, as it is in the address.
 */
export function FiltersMenu({ view, filters }: { view: BoardView; filters: BoardFilters }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (next: BoardFilters) => {
    setOpen(false);
    router.push(boardHref({ view, filters: next }));
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const category = String(data.get("category"));
    const urgency = String(data.get("urgency"));
    go({
      category: (CATEGORY_CODES as readonly string[]).includes(category) ? (category as BoardFilters["category"]) : null,
      assignee: String(data.get("assignee")) as AssigneeFilter,
      urgency: (URGENCIES as readonly string[]).includes(urgency) ? (urgency as Urgency) : null,
      q: flatCodePrefix(String(data.get("q"))),
    });
  };
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t("staffComplaints.filters.button")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("staffComplaints.filters.title")}>
        <form key={JSON.stringify(filters)} onSubmit={apply} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-body">
            {t("staffComplaints.filters.category")}
            <select name="category" defaultValue={filters.category ?? ""} className={FIELD}>
              <option value="">{t("staffComplaints.filters.anyCategory")}</option>
              {CATEGORY_CODES.map((code) => (
                <option key={code} value={code}>
                  {categoryName(code)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body">
            {t("staffComplaints.filters.assignee")}
            <select name="assignee" defaultValue={filters.assignee} className={FIELD}>
              <option value="anyone">{t("staffComplaints.filters.anyone")}</option>
              <option value="me">{t("staffComplaints.filters.me")}</option>
              <option value="unassigned">{t("staffComplaints.filters.unassigned")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body">
            {t("staffComplaints.filters.urgency")}
            <select name="urgency" defaultValue={filters.urgency ?? ""} className={FIELD}>
              <option value="">{t("staffComplaints.filters.anyUrgency")}</option>
              {URGENCIES.map((urgency) => (
                <option key={urgency} value={urgency}>
                  {urgencyLabel(urgency)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body">
            {t("staffComplaints.filters.flat")}
            <input name="q" defaultValue={filters.q ?? ""} maxLength={8} autoComplete="off" className={FIELD} aria-describedby="filters-flat-hint" />
            <span id="filters-flat-hint" className="text-caption text-ink-2">
              {t("staffComplaints.filters.flatHint")}
            </span>
          </label>
          <div className="flex gap-2">
            <Button type="submit">{t("staffComplaints.filters.apply")}</Button>
            <Button variant="outlined" disabled={!hasFilters(filters)} onClick={() => go(NO_FILTERS)}>
              {t("staffComplaints.filters.reset")}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
