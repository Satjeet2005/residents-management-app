"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { BoardView } from "@/domain/complaints/board-views";
import { t } from "@/lib/messages";
import type { BoardFilters } from "@/lib/staff-complaints/board-query";
import { viewLabel } from "@/lib/staff-complaints/views";
import { ViewList } from "./view-list";

/** The "View" button (48px) with the current view and its count; it opens the views sheet. Selecting a view closes the sheet and changes the address. Below 1024px only. */
export function ViewsMenu({ view, counts, filters }: { view: BoardView; counts: Record<BoardView, number>; filters: BoardFilters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t("staffComplaints.view.current", { view: viewLabel(view) })} <span className="tnum">{counts[view]}</span>
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("staffComplaints.view.sheetTitle")}>
        <ViewList view={view} counts={counts} filters={filters} onSelect={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
