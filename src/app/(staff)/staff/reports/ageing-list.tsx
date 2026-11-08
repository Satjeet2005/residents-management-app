"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import type { AgeBucket, AgeingSort } from "@/domain/reports/age";
import { t } from "@/lib/messages";
import { bucketLabel } from "@/lib/reports/ageing";
import { countText } from "@/lib/reports/cards";
import { AGEING_PAGE_SIZE } from "@/lib/reports/cursor";
import type { AgeingRowView } from "@/server/reports/ageing-page";
import { loadMoreAgeing } from "./actions";
import { AgeingRows } from "./ageing-rows";

/**
 * The flats of one age group: the first page from the server, then "Show 25 more" (keyset, 25 at a time, in the order asked for) under "Showing 25 of 115". A failure
 * shows an error with Try again. The list is keyed by group and order, so changing either starts a new list.
 */
export function AgeingList({ bucket, sort, total, initialRows, initialCursor }: { bucket: AgeBucket; sort: AgeingSort; total: number; initialRows: AgeingRowView[]; initialCursor: string | null }) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [phase, setPhase] = useState<"IDLE" | "LOADING" | "FAILED">("IDLE");

  async function loadMore() {
    if (cursor === null || phase === "LOADING") return;
    setPhase("LOADING");
    try {
      const answer = await loadMoreAgeing({ bucket, sort, cursor });
      if (!answer.ok || answer.data === null) return setPhase("FAILED");
      const seen = new Set(rows.map((r) => r.flatCode));
      setRows([...rows, ...answer.data.rows.filter((r) => !seen.has(r.flatCode))]);
      setCursor(answer.data.nextCursor);
      setPhase("IDLE");
    } catch {
      setPhase("FAILED");
    }
  }

  const remaining = total - rows.length;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-body text-ink-2">{t("committee.drill.empty")}</p>
      ) : (
        <AgeingRows rows={rows} caption={t("committee.drill.caption", { bucket: bucketLabel(bucket), order: (sort === "OLDEST" ? t("committee.drill.sort.oldest") : t("committee.drill.sort.largest")).toLowerCase() })} />
      )}
      {rows.length > 0 && <p className="tnum text-body text-ink-2">{t("committee.drill.showing", { shown: countText(rows.length), total: countText(total) })}</p>}
      {phase === "FAILED" && <BlockError message={t("committee.drill.loadError")} onRetry={loadMore} />}
      {cursor !== null && phase !== "FAILED" && (
        <Button variant="outlined" loading={phase === "LOADING"} loadingLabel={t("committee.drill.loading")} onClick={loadMore}>
          {t("committee.drill.more", { n: Math.min(AGEING_PAGE_SIZE, remaining) })}
        </Button>
      )}
    </div>
  );
}
