"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import type { AgeBucket } from "@/domain/reports/age";
import { t } from "@/lib/messages";
import { bucketLabel } from "@/lib/reports/ageing";
import type { AgeingRowView } from "@/server/reports/ageing-page";
import { loadMoreAgeing } from "./actions";
import { AgeingRows } from "./ageing-rows";

/** The rows of one age group: the first page from the server, then "Load more" (keyset, 25 at a time, oldest first). A failure shows an error with Try again. */
export function AgeingList({ bucket, initialRows, initialCursor }: { bucket: AgeBucket; initialRows: AgeingRowView[]; initialCursor: string | null }) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [phase, setPhase] = useState<"IDLE" | "LOADING" | "FAILED">("IDLE");

  async function loadMore() {
    if (cursor === null || phase === "LOADING") return;
    setPhase("LOADING");
    try {
      const answer = await loadMoreAgeing({ bucket, cursor });
      if (!answer.ok || answer.data === null) return setPhase("FAILED");
      const seen = new Set(rows.map((r) => r.billId));
      setRows([...rows, ...answer.data.rows.filter((r) => !seen.has(r.billId))]);
      setCursor(answer.data.nextCursor);
      setPhase("IDLE");
    } catch {
      setPhase("FAILED");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 ? <p className="text-body text-ink-2">{t("committee.drill.empty")}</p> : <AgeingRows rows={rows} caption={t("committee.drill.caption", { bucket: bucketLabel(bucket) })} />}
      {phase === "FAILED" && <BlockError message={t("committee.drill.loadError")} onRetry={loadMore} />}
      {cursor !== null && phase !== "FAILED" && (
        <Button variant="outlined" loading={phase === "LOADING"} loadingLabel={t("committee.drill.loading")} onClick={loadMore}>
          {t("committee.drill.loadMore")}
        </Button>
      )}
    </div>
  );
}
