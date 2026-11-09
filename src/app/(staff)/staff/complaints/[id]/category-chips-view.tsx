import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { CHIP_CODES, type ChipsState, chipState } from "@/lib/staff-complaints/category-chips";
import { categoryName } from "@/lib/staff-complaints/labels";
import { errorText } from "./panel-view";
import type { CategoryCode } from "@/domain/complaints/taxonomy";

export type ChipsHandlers = { onTap: (code: CategoryCode) => void; onUndo: () => void; onReload: () => void };

/** The five category chips (D239): the complaint's category is pressed, a tap on another one changes it. Pure markup over the state; a closed complaint shows them disabled. */
export function CategoryChipsView({ state, closed, handlers, feedbackRef }: { state: ChipsState; closed: boolean; handlers: ChipsHandlers; feedbackRef?: Ref<HTMLDivElement> }) {
  const message = state.message === null ? null : state.message.kind === "CHANGED" ? t("staffComplaints.done.category", { category: categoryName(state.message.category) }) : errorText(state.message.error);
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("staffComplaints.fact.category")} className="flex flex-wrap gap-2">
        {CHIP_CODES.map((code) => {
          const chip = chipState({ code, current: state.category, closed, pending: state.pending });
          return (
            <button
              key={code}
              type="button"
              aria-pressed={chip.pressed}
              aria-disabled={chip.disabled || undefined}
              onClick={() => handlers.onTap(code)}
              className={cx(
                "inline-flex min-h-12 items-center justify-center rounded-control px-4 text-body font-semibold text-ink",
                chip.pressed ? "border-2 border-ink bg-paper-2" : "border-2 border-control bg-paper",
                chip.disabled && "text-ink-2",
              )}
            >
              {categoryName(code)}
            </button>
          );
        })}
      </div>
      <div ref={feedbackRef} style={{ scrollMarginBottom: "7rem" }} className="flex flex-col items-start gap-2">
        <div role="status" aria-live="polite" className={message === null ? "sr-only" : "text-body"}>
          {message}
        </div>
        {state.message?.kind === "ERROR" && state.message.error === "STALE" && (
          <Button variant="outlined" onClick={handlers.onReload}>
            {t("staffComplaints.reload")}
          </Button>
        )}
        {state.undo !== null && (
          <Button variant="link" onClick={handlers.onUndo}>
            {t("staffComplaints.chips.undo")}
          </Button>
        )}
      </div>
    </div>
  );
}
