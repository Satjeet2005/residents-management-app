"use client";

import { type ReactNode, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { DETAIL_TABS, type DetailTab } from "@/lib/staff-complaints/detail";
import { nextTabIndex } from "@/lib/reconciliation/lanes";

const tabId = (tab: DetailTab): string => `complaint-tab-${tab}`;
const panelId = (tab: DetailTab): string => `complaint-panel-${tab}`;
const labelOf = (tab: DetailTab): string => (tab === "details" ? t("staffComplaints.tab.details") : t("staffComplaints.tab.timeline"));

/**
 * Details and Timeline as a tablist (arrow keys, Home and End move between the two and show that one). BOTH panels are rendered by the server and only the chosen one
 * is shown, so nothing waits for a request; the chosen tab is kept in the address (`?tab=`), which also decides the first tab on a reload or a shared link.
 */
export function DetailTabs({ initial, details, timeline }: { initial: DetailTab; details: ReactNode; timeline: ReactNode }) {
  const [tab, setTab] = useState<DetailTab>(initial);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: DetailTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("staffComplaints.tab.label")} className="flex gap-2">
        {DETAIL_TABS.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={tabId(name)}
            type="button"
            role="tab"
            aria-selected={name === tab}
            aria-controls={panelId(name)}
            tabIndex={name === tab ? 0 : -1}
            onClick={() => choose(name)}
            onKeyDown={(event) => {
              const to = nextTabIndex(event.key, index, DETAIL_TABS.length);
              if (to === null) return;
              event.preventDefault();
              buttons.current[to]?.focus();
              choose(DETAIL_TABS[to]);
            }}
            className={cx("inline-flex min-h-12 flex-1 items-center justify-center rounded-control border-2 px-4 text-body", name === tab ? "border-ink bg-paper-2 font-semibold" : "border-control bg-paper")}
          >
            {labelOf(name)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId("details")} aria-labelledby={tabId("details")} hidden={tab !== "details"} className="flex flex-col gap-4">
        {details}
      </div>
      <div role="tabpanel" id={panelId("timeline")} aria-labelledby={tabId("timeline")} hidden={tab !== "timeline"} className="flex flex-col gap-4">
        {timeline}
      </div>
    </div>
  );
}
