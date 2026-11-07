"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/messages";
import { type BoardLane, emptyLaneText, laneLabel } from "@/lib/staff-complaints/lanes";
import type { BoardRow } from "@/server/complaints/board";
import { loadMoreComplaints } from "./actions";
import { BoardRows } from "./board-rows";
import { boardPanelId, boardTabId } from "./lane-tabs";

/** The complaints of the chosen lane as the tab panel: the first page from the server, then "Load more" (keyset, newest first). */
export function BoardList({ lane, initialRows, initialCursor, now }: { lane: BoardLane; initialRows: BoardRow[]; initialCursor: string | null; now: number }) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [phase, setPhase] = useState<"IDLE" | "LOADING" | "FAILED">("IDLE");

  async function loadMore() {
    if (cursor === null || phase === "LOADING") return;
    setPhase("LOADING");
    try {
      const answer = await loadMoreComplaints({ lane, cursor });
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
    <div role="tabpanel" id={boardPanelId} aria-labelledby={boardTabId(lane)} className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 ? <p className="text-body text-ink-2">{emptyLaneText()}</p> : <BoardRows rows={rows} caption={t("staffComplaints.list.caption", { lane: laneLabel(lane) })} now={now} />}
      {phase === "FAILED" && <BlockError message={t("staffComplaints.list.loadError")} onRetry={loadMore} />}
      {cursor !== null && phase !== "FAILED" && (
        <Button variant="outlined" loading={phase === "LOADING"} loadingLabel={t("staffComplaints.list.loading")} onClick={loadMore}>
          {t("staffComplaints.list.loadMore")}
        </Button>
      )}
    </div>
  );
}
