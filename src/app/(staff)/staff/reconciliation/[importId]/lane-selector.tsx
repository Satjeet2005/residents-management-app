"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { laneLabel, nextTabIndex, workspaceHref } from "@/lib/reconciliation/lanes";
import { LANES, type Lane } from "@/lib/reconciliation/types";

export const lanePanelId = "recon-lane-panel";
export const laneTabId = (lane: Lane): string => `recon-tab-${lane}`;

/**
 * The lane selector (D190), the one place the four lanes and their counts are written: four equal cards in a tablist, each with the count above the lane's name
 * (the UNFILTERED lane total). The name comes first in the page and the count after it, and the cards are drawn count over name, so the accessible name, "Needs you 42 rows", is the visible words in order. Arrow keys, Home and End move between
 * them and show that lane. Each card is a link, so it also works without a script, and the lane is in the URL (`?lane=`). Only the selected card is in the tab order.
 * Under the cards, when rows were posted by hand, one line about Posted splits automatic from by hand.
 */
export function LaneSelector({ importId, lane, laneCounts, manuallyPosted }: { importId: string; lane: Lane; laneCounts: Record<Lane, number>; manuallyPosted: number }) {
  const router = useRouter();
  const tabs = useRef<(HTMLAnchorElement | null)[]>([]);
  return (
    <div className="flex flex-col gap-1">
      <div role="tablist" aria-label={t("recon.lanes.label")} className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {LANES.map((l, index) => (
          <Link
            key={l}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            id={laneTabId(l)}
            role="tab"
            aria-selected={l === lane}
            aria-controls={lanePanelId}
            tabIndex={l === lane ? 0 : -1}
            href={workspaceHref({ importId, lane: l })}
            onKeyDown={(event) => {
              const to = nextTabIndex(event.key, index, LANES.length);
              if (to === null) return;
              event.preventDefault();
              tabs.current[to]?.focus();
              router.push(workspaceHref({ importId, lane: LANES[to] }));
            }}
            className={cx("flex min-h-16 min-w-0 flex-col-reverse justify-center rounded-control", l === lane ? "border-2 border-ink bg-paper-2 px-[10px] py-[2px]" : "border border-hairline px-[11px] py-[3px]")}
          >
            <span className="text-caption text-ink-2">{laneLabel(l)}</span>
            <span className="tnum text-heading font-semibold">{laneCounts[l]}</span>
            <span className="sr-only">{` ${laneCounts[l] === 1 ? t("recon.lane.rowOne") : t("recon.lane.rowMany")}`}</span>
          </Link>
        ))}
      </div>
      {manuallyPosted > 0 && <p className="tnum text-caption text-ink-2">{t("recon.lane.postedSplit", { auto: laneCounts.MATCHED - manuallyPosted, hand: manuallyPosted })}</p>}
    </div>
  );
}
