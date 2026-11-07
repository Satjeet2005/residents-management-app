"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { BOARD_LANES, type BoardLane, boardHref, laneLabel, nextTabIndex } from "@/lib/staff-complaints/lanes";

export const boardPanelId = "complaints-lane-panel";
export const boardTabId = (lane: BoardLane): string => `complaints-tab-${lane}`;

/**
 * The six lanes as a tablist (arrow keys, Home and End move between them and show that lane). Each tab is a link, so it works without a script, and the
 * lane is in the address (`?lane=`). Only the selected tab is in the tab order. The count of every lane is on its tab.
 */
export function LaneTabs({ lane, counts }: { lane: BoardLane; counts: Record<BoardLane, number> }) {
  const router = useRouter();
  const tabs = useRef<(HTMLAnchorElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={t("staffComplaints.lanes.label")} className="flex flex-wrap gap-2">
      {BOARD_LANES.map((l, index) => (
        <Link
          key={l}
          ref={(element) => {
            tabs.current[index] = element;
          }}
          id={boardTabId(l)}
          role="tab"
          aria-selected={l === lane}
          aria-controls={boardPanelId}
          tabIndex={l === lane ? 0 : -1}
          href={boardHref(l)}
          onKeyDown={(event) => {
            const to = nextTabIndex(event.key, index, BOARD_LANES.length);
            if (to === null) return;
            event.preventDefault();
            tabs.current[to]?.focus();
            router.push(boardHref(BOARD_LANES[to]));
          }}
          className={cx("inline-flex min-h-12 items-center gap-2 rounded-control border-2 px-4 text-body", l === lane ? "border-ink bg-paper-2 font-semibold" : "border-control bg-paper")}
        >
          {laneLabel(l)}
          <span className="tnum">{counts[l]}</span>
        </Link>
      ))}
    </div>
  );
}
