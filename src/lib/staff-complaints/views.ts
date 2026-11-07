import type { BoardView } from "@/domain/complaints/board-views";
import { t } from "@/lib/messages";

export function viewLabel(view: BoardView): string {
  switch (view) {
    case "needs_action":
      return t("staffComplaints.view.needsAction");
    case "mine":
      return t("staffComplaints.view.mine");
    case "safety":
      return t("staffComplaints.view.safety");
    case "triage":
      return t("staffComplaints.view.triage");
    case "open":
      return t("staffComplaints.view.open");
    case "overdue":
      return t("staffComplaints.view.overdue");
    case "waiting":
      return t("staffComplaints.view.waiting");
    case "closed":
      return t("staffComplaints.view.closed");
  }
}

/** The one plain sentence under each view in the views sheet and the sidebar. */
export function viewSentence(view: BoardView): string {
  switch (view) {
    case "needs_action":
      return t("staffComplaints.view.needsAction.about");
    case "mine":
      return t("staffComplaints.view.mine.about");
    case "safety":
      return t("staffComplaints.view.safety.about");
    case "triage":
      return t("staffComplaints.view.triage.about");
    case "open":
      return t("staffComplaints.view.open.about");
    case "overdue":
      return t("staffComplaints.view.overdue.about");
    case "waiting":
      return t("staffComplaints.view.waiting.about");
    case "closed":
      return t("staffComplaints.view.closed.about");
  }
}

/** What an empty page says: with a filter on, that nothing matches it; otherwise that everything is handled. */
export const emptyViewText = (filtered: boolean): string => (filtered ? t("staffComplaints.row.noMatch") : t("staffComplaints.row.empty"));

/** The safety banner of the board: how many safety complaints wait for the duty manager. Null when none. */
export const safetyAlertText = (waiting: number): string | null => (waiting <= 0 ? null : waiting === 1 ? t("staffComplaints.alert.one") : t("staffComplaints.alert.many", { n: waiting }));
