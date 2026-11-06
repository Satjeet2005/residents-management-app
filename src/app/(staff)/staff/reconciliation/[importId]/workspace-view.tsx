import Link from "next/link";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { actionsAllowed } from "@/lib/reconciliation/summary";
import type { Lane } from "@/lib/reconciliation/types";
import type { Workspace } from "@/server/statements/ui-data";
import { LaneTabs } from "./lane-tabs";
import { MAIN_ID, ReviewPanel } from "./review-panel";
import { RowList } from "./row-list";
import { SummaryBar } from "./summary-bar";

/** The row to move to after the selected one is decided: the next in the list, else the one before it, else none. */
export function nextRowOf(rows: readonly { id: string }[], selectedId: string | null): string | null {
  const index = rows.findIndex((r) => r.id === selectedId);
  if (index === -1) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}

/** The workspace of one import: header, summary bar, lane tabs, the rows of the chosen lane and, when ?row= names one, its review panel. */
export function WorkspaceView({ data, lane }: { data: Workspace; lane: Lane }) {
  const { header, counts, laneCounts, review } = data;
  return (
    <>
      <div id={MAIN_ID} className={review === null ? "" : "lg:pr-[28rem]"}>
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <Link href="/staff/reconciliation" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
              {t("recon.ws.back")}
            </Link>
            <h1 className="break-words text-heading font-semibold">{header.filename}</h1>
            <p className="tnum text-body text-ink-2">{t("recon.ws.imported", { date: formatDayYear(header.uploadedOn), name: header.uploadedBy })}</p>
          </div>
          <SummaryBar counts={counts} />
          <LaneTabs importId={header.importId} lane={lane} laneCounts={laneCounts} />
          <RowList key={`${lane}:${JSON.stringify(laneCounts)}`} importId={header.importId} lane={lane} initialRows={data.rows} initialCursor={data.nextCursor} selectedId={review?.id ?? null} />
        </main>
      </div>
      {review !== null && <ReviewPanel key={review.id} review={review} importId={header.importId} lane={lane} nextRowId={nextRowOf(data.rows, review.id)} actionsAllowed={actionsAllowed(counts)} />}
    </>
  );
}
