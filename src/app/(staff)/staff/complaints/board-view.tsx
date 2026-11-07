import { t } from "@/lib/messages";
import type { BoardPage } from "@/server/complaints/staff-page-data";
import { BoardList } from "./board-list";
import { LaneTabs } from "./lane-tabs";

/** The board: one h1, the six lanes as tabs with their counts, and the complaints of the chosen lane. No control on the page is filled. */
export function BoardView({ page }: { page: BoardPage }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("staffComplaints.title")}</h1>
      <LaneTabs lane={page.lane} counts={page.counts} />
      <BoardList key={`${page.lane}:${JSON.stringify(page.counts)}`} lane={page.lane} initialRows={page.rows} initialCursor={page.nextCursor} now={page.now} />
    </main>
  );
}
