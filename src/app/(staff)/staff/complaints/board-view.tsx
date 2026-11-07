import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import { t } from "@/lib/messages";
import { NO_FILTERS, boardHref } from "@/lib/staff-complaints/board-query";
import { safetyAlertText } from "@/lib/staff-complaints/views";
import type { BoardPage } from "@/server/complaints/staff-page-data";
import { BoardList } from "./board-list";
import { FilterChips } from "./filter-chips";
import { FiltersMenu } from "./filters-menu";
import { ViewList } from "./view-list";
import { ViewsMenu } from "./views-menu";

/**
 * The board (D151): one h1; an alert strip when a safety complaint waits for the duty manager; the demo note in demo mode; the View button and the Filters button
 * (the views are a left sidebar from 1024px); the active filters as chips; and the complaints of the chosen view. No control on the page is filled.
 */
export function BoardView({ page, demo }: { page: BoardPage; demo: boolean }) {
  const alert = safetyAlertText(page.unacknowledgedSafety);
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4 lg:flex-row lg:items-start lg:gap-8">
      <aside className="hidden w-80 shrink-0 lg:block">
        <ViewList view={page.view} counts={page.counts} filters={page.filters} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h1 className="text-heading font-semibold">{t("staffComplaints.title")}</h1>
        {alert !== null && (
          <Link href={boardHref({ view: "safety", filters: NO_FILTERS })} className="flex min-h-12 items-center gap-2 rounded-control border-2 border-caution px-3 py-2 text-body font-semibold text-caution">
            <WarningIcon />
            {alert}
          </Link>
        )}
        {demo && <p className="text-caption text-ink-2">{t("staffComplaints.demoNote")}</p>}
        <div className="flex flex-wrap gap-2">
          <div className="lg:hidden">
            <ViewsMenu view={page.view} counts={page.counts} filters={page.filters} />
          </div>
          <FiltersMenu view={page.view} filters={page.filters} />
        </div>
        <FilterChips view={page.view} filters={page.filters} />
        <BoardList key={`${page.view}:${JSON.stringify(page.filters)}:${JSON.stringify(page.counts)}`} view={page.view} filters={page.filters} initialRows={page.rows} initialCursor={page.nextCursor} total={page.total} now={page.now} />
      </div>
    </main>
  );
}

