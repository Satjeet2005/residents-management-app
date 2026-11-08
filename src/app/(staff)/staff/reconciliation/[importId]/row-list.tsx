"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/messages";
import { laneLabel } from "@/lib/reconciliation/lanes";
import type { Viewer } from "@/lib/reconciliation/permission-view";
import type { Lane, RowCard } from "@/lib/reconciliation/types";
import { loadMoreRows } from "./actions";
import { lanePanelId, laneTabId } from "./lane-selector";
import { RowsView } from "./rows-view";

export function emptyLaneText(lane: Lane): string {
  switch (lane) {
    case "NEEDS_YOU":
      return t("recon.empty.needsYou");
    case "AWAITING_APPROVAL":
      return t("recon.empty.awaiting");
    case "MATCHED":
      return t("recon.empty.posted");
    case "NOT_MAINTENANCE":
      return t("recon.empty.notMaintenance");
  }
}

/** The rows of the chosen lane, as the tab panel: the first page from the server, then "Load more" (keyset, 25 at a time). */
export function RowList({ importId, lane, initialRows, initialCursor, selectedId, viewer }: { importId: string; lane: Lane; initialRows: RowCard[]; initialCursor: string | null; selectedId: string | null; viewer: Viewer }) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [phase, setPhase] = useState<"IDLE" | "LOADING" | "FAILED">("IDLE");

  async function loadMore() {
    if (cursor === null || phase === "LOADING") return;
    setPhase("LOADING");
    try {
      const answer = await loadMoreRows({ importId, lane, cursor });
      if (!answer.ok || answer.data === null) return setPhase("FAILED");
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...answer.data.rows.filter((r) => !seen.has(r.id))]);
      setCursor(answer.data.nextCursor);
      setPhase("IDLE");
    } catch {
      setPhase("FAILED");
    }
  }

  return (
    <div role="tabpanel" id={lanePanelId} aria-labelledby={laneTabId(lane)} className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 ? <p className="text-body text-ink-2">{emptyLaneText(lane)}</p> : <RowsView rows={rows} caption={t("recon.list.caption", { lane: laneLabel(lane) })} importId={importId} lane={lane} selectedId={selectedId} viewer={viewer} />}
      {phase === "FAILED" && <BlockError message={t("recon.list.loadError")} onRetry={loadMore} />}
      {cursor !== null && phase !== "FAILED" && (
        <Button variant="outlined" loading={phase === "LOADING"} loadingLabel={t("recon.list.loading")} onClick={loadMore}>
          {t("recon.list.loadMore")}
        </Button>
      )}
    </div>
  );
}
