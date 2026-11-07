import Link from "next/link";
import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import type { BoardView } from "@/domain/complaints/board-views";
import { t } from "@/lib/messages";
import { type BoardFilters, NO_FILTERS, boardHref, hasFilters } from "@/lib/staff-complaints/board-query";
import { categoryName, urgencyLabel } from "@/lib/staff-complaints/labels";

type Chip = { key: string; text: string; remove: BoardFilters };

function chipsOf(filters: BoardFilters): Chip[] {
  const chips: Chip[] = [];
  if (filters.category !== null) chips.push({ key: "category", text: t("staffComplaints.filters.chipCategory", { value: categoryName(filters.category) }), remove: { ...filters, category: null } });
  if (filters.assignee !== "anyone")
    chips.push({ key: "assignee", text: t("staffComplaints.filters.chipAssignee", { value: filters.assignee === "me" ? t("staffComplaints.filters.me") : t("staffComplaints.filters.unassigned") }), remove: { ...filters, assignee: NO_FILTERS.assignee } });
  if (filters.urgency !== null) chips.push({ key: "urgency", text: t("staffComplaints.filters.chipUrgency", { value: urgencyLabel(filters.urgency) }), remove: { ...filters, urgency: null } });
  if (filters.q !== null) chips.push({ key: "q", text: t("staffComplaints.filters.chipFlat", { value: filters.q }), remove: { ...filters, q: null } });
  return chips;
}

/** The active filters as removable chips under the header: each is a 48px link to the same board without that one filter. */
export function FilterChips({ view, filters }: { view: BoardView; filters: BoardFilters }): ReactNode {
  if (!hasFilters(filters)) return null;
  return (
    <ul aria-label={t("staffComplaints.filters.active")} className="flex flex-wrap gap-2">
      {chipsOf(filters).map((chip) => (
        <li key={chip.key}>
          <Link
            href={boardHref({ view, filters: chip.remove })}
            aria-label={t("staffComplaints.filters.remove", { filter: chip.text })}
            className="inline-flex min-h-12 items-center gap-2 rounded-control border-2 border-control bg-paper-2 px-3 text-caption font-semibold"
          >
            {chip.text}
            <CloseIcon size={16} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
