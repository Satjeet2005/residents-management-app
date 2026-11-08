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
 * The four lanes as a tablist (arrow keys, Home and End move between them and show that lane). Each tab is a link, so it also works
 * without a script, and the lane is in the URL (`?lane=`). Only the selected tab is in the tab order.
 */
export function LaneTabs({ importId, lane, laneCounts }: { importId: string; lane: Lane; laneCounts: Record<Lane, number> }) {
  const router = useRouter();
  const tabs = useRef<(HTMLAnchorElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={t("recon.lanes.label")} className="flex flex-wrap gap-2">
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
          className={cx(
            "inline-flex min-h-12 items-center gap-2 rounded-control border-2 px-4 text-body",
            l === lane ? "border-ink bg-paper-2 font-semibold" : "border-control bg-paper",
          )}
        >
          {laneLabel(l)}
          <span className="tnum">{laneCounts[l]}</span>
        </Link>
      ))}
    </div>
  );
}
