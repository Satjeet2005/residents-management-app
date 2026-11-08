import type { Viewer } from "@/lib/reconciliation/permission-view";
import { actionsAllowed } from "@/lib/reconciliation/summary";
import type { Lane } from "@/lib/reconciliation/types";
import type { Workspace } from "@/server/statements/ui-data";
import { LaneSelector } from "./lane-selector";
import { MAIN_ID, ReviewPanel } from "./review-panel";
import { RowList } from "./row-list";
import { ProportionStrip } from "./proportion-strip";
import { WorkspaceHeader } from "./workspace-header";

/** The row to move to after the selected one is decided: the next in the list, else the one before it, else none. */
export function nextRowOf(rows: readonly { id: string }[], selectedId: string | null): string | null {
  const index = rows.findIndex((r) => r.id === selectedId);
  if (index === -1) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}

/** The workspace of one import: header, proportion strip, lane selector, the rows of the chosen lane and, when ?row= names one, its review panel. */
export function WorkspaceView({ data, lane, viewer }: { data: Workspace; lane: Lane; viewer: Viewer }) {
  const { header, counts, laneCounts, review } = data;
  return (
    <>
      <div id={MAIN_ID} className={review === null ? "" : "lg:pr-[28rem]"}>
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
          <WorkspaceHeader header={header} counts={counts} />
          <ProportionStrip laneCounts={laneCounts} />
          <LaneSelector importId={header.importId} lane={lane} laneCounts={laneCounts} manuallyPosted={counts.manuallyMatched} />
          <RowList key={`${lane}:${JSON.stringify(laneCounts)}`} importId={header.importId} lane={lane} initialRows={data.rows} initialCursor={data.nextCursor} selectedId={review?.id ?? null} viewer={viewer} thresholdPaise={data.thresholdPaise} laneTotal={laneCounts[lane]} />
        </main>
      </div>
      {review !== null && <ReviewPanel key={review.id} review={review} importId={header.importId} lane={lane} nextRowId={nextRowOf(data.rows, review.id)} actionsAllowed={actionsAllowed(counts)} />}
    </>
  );
}
