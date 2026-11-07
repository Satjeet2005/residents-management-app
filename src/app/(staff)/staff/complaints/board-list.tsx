"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import type { BoardView } from "@/domain/complaints/board-views";
import { t } from "@/lib/messages";
import { type BoardFilters, hasFilters } from "@/lib/staff-complaints/board-query";
import { emptyViewText, viewLabel } from "@/lib/staff-complaints/views";
import type { BoardRow } from "@/server/complaints/board-views";
import { VIEW_PAGE_SIZE } from "@/server/complaints/page-size";
import { loadMoreComplaints } from "./actions";
import { BoardRows } from "./board-rows";

/** The complaints of the chosen view: the first page from the server, then "Show 15 more" (keyset) and "Showing 15 of <n>". */
export function BoardList({ view, filters, initialRows, initialCursor, total, now }: { view: BoardView; filters: BoardFilters; initialRows: BoardRow[]; initialCursor: string | null; total: number; now: number }) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [phase, setPhase] = useState<"IDLE" | "LOADING" | "FAILED">("IDLE");

  async function loadMore() {
    if (cursor === null || phase === "LOADING") return;
    setPhase("LOADING");
    try {
      const answer = await loadMoreComplaints({ view, cursor, category: filters.category, assignee: filters.assignee, urgency: filters.urgency, q: filters.q });
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
    <section aria-label={t("staffComplaints.row.caption", { view: viewLabel(view) })} className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-body text-ink-2">{emptyViewText(hasFilters(filters))}</p>
      ) : (
        <>
          <BoardRows rows={rows} caption={t("staffComplaints.row.caption", { view: viewLabel(view) })} now={now} />
          <p className="tnum text-caption text-ink-2">{t("staffComplaints.list.showing", { shown: rows.length, total })}</p>
        </>
      )}
      {phase === "FAILED" && <BlockError message={t("staffComplaints.list.loadError")} onRetry={loadMore} />}
      {cursor !== null && phase !== "FAILED" && (
        <Button variant="outlined" loading={phase === "LOADING"} loadingLabel={t("staffComplaints.list.loading")} onClick={loadMore}>
          {t("staffComplaints.list.showMore", { n: Math.min(VIEW_PAGE_SIZE, Math.max(1, total - rows.length)) })}
        </Button>
      )}
    </section>
  );
}
