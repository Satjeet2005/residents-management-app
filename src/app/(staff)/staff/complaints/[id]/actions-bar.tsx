"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { t } from "@/lib/messages";
import type { Controls } from "@/lib/staff-complaints/controls";
import type { PanelAction } from "@/lib/staff-complaints/panel";
import { type BarKind, barControls, onlyControls, sheetRows } from "@/lib/staff-complaints/primary-bar";
import { PanelView, doneText, errorText } from "./panel-view";
import { useStaffActions } from "./use-staff-actions";

type Row = Exclude<PanelAction, "ACKNOWLEDGE">;

function rowLabel(row: Row): string {
  switch (row) {
    case "ASSIGN":
      return t("staffComplaints.actions.assign");
    case "START":
      return t("staffComplaints.statusPanel.start");
    case "RESOLVE":
      return t("staffComplaints.statusPanel.resolve");
    case "COMMENT":
      return t("staffComplaints.actions.comment");
    case "CATEGORY":
      return t("staffComplaints.actions.category");
    case "CLOSE":
      return t("staffComplaints.safetyPanel.close");
  }
}

type Props = {
  id: string;
  version: number;
  kind: Exclude<BarKind, "NONE">;
  controls: Controls;
  staffUsers: readonly { id: string; name: string }[];
  currentCategory: string | null;
  needsReview: boolean;
};

/**
 * The phone's pinned action bar and its actions sheet (D152), below 1024px. The bar is fixed to the bottom with the safe-area inset and holds buttons only, no text
 * input: the duty manager's "I have seen this" (the one filled control) with "More", or "Update". The sheet is a short menu of rows; a row opens its own small form,
 * one at a time. After an action works the sheet closes, the page refreshes and a live message says what changed; focus goes back to the control that opened the sheet.
 */
export function ActionsBar({ id, version, kind, controls, staffUsers, currentCategory, needsReview }: Props) {
  const { state, dispatch, submit, reload } = useStaffActions({ id, version, staffUsers });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Row | null>(null);

  const openSheet = () => {
    dispatch({ type: "DISMISSED" });
    setView(null);
    setOpen(true);
  };
  const choose = (row: Row) => {
    if (row === "RESOLVE" || row === "CLOSE") dispatch({ type: "NOTE_OPENED", form: row });
    setView(row);
  };
  const backToMenu = () => {
    dispatch({ type: "NOTE_CLOSED" });
    setView(null);
  };

  const rows = sheetRows(controls);
  const message = state.done !== null ? doneText(state.done) : state.error !== null && !open ? errorText(state.error.error) : null;
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-2 border-t border-hairline bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div role="status" className={message === null ? "sr-only" : "text-caption font-semibold"}>
          {message}
        </div>
        {state.error?.error === "STALE" && !open && (
          <Button variant="outlined" onClick={reload}>
            {t("staffComplaints.reload")}
          </Button>
        )}
        <div className="flex gap-2">
          {barControls(kind).map((control) =>
            control.id === "ACKNOWLEDGE" ? (
              <Button key={control.id} variant="primary" loading={state.pending === "ACKNOWLEDGE"} loadingLabel={t("staffComplaints.working")} disabled={state.pending !== null && state.pending !== "ACKNOWLEDGE"} onClick={() => void submit("ACKNOWLEDGE")}>
                {t("staffComplaints.safetyPanel.acknowledge")}
              </Button>
            ) : (
              <Button key={control.id} variant="outlined" aria-haspopup="dialog" onClick={openSheet}>
                {control.id === "MORE" ? t("staffComplaints.bar.more") : t("staffComplaints.bar.update")}
              </Button>
            ),
          )}
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("staffComplaints.actions.title")}>
        {view === null ? (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row}>
                <Button variant="outlined" fullWidth onClick={() => choose(row)}>
                  {rowLabel(row)}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-4">
            <PanelView
              idPrefix="sheet-"
              state={state}
              controls={onlyControls(view)}
              staffUsers={staffUsers}
              currentCategory={currentCategory}
              needsReview={needsReview}
              handlers={{
                onField: (field, value) => dispatch({ type: "FIELD", field, value }),
                onToggleVisible: () => dispatch({ type: "VISIBLE_TOGGLED" }),
                onOpenNote: (form) => dispatch({ type: "NOTE_OPENED", form }),
                onCloseNote: backToMenu,
                onSubmit: (action) => void submit(action).then((worked) => worked && setOpen(false)),
                onReload: reload,
              }}
            />
            <Button variant="outlined" onClick={backToMenu}>
              {t("staffComplaints.actions.back")}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

