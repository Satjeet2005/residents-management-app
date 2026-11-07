import type { Controls, ControlsInput } from "./controls";
import { controlsFor } from "./controls";
import type { PanelAction } from "./panel";

/** What the pinned bar of a phone shows (D152): nothing, the duty manager's "I have seen this" with "More", or "Update". */
export type BarKind = "NONE" | "ACKNOWLEDGE" | "UPDATE";
export type BarControl = { id: "ACKNOWLEDGE" | "MORE" | "UPDATE"; filled: boolean };

/**
 * The bar by role and state. No bar for a user without `complaints:manage` and for a closed complaint. The duty manager on a safety complaint they have not
 * acknowledged gets "I have seen this" as the ONLY filled control, and an outlined "More"; everybody else who may manage gets an outlined "Update" (which opens the
 * actions sheet). A plain manager is never offered "I have seen this": it comes from `controlsFor`, which only the duty manager has.
 */
export function barKind(input: ControlsInput): BarKind {
  if (!input.viewer.canManage || input.status === "CLOSED") return "NONE";
  return controlsFor(input).acknowledge ? "ACKNOWLEDGE" : "UPDATE";
}

export function barControls(kind: BarKind): BarControl[] {
  switch (kind) {
    case "NONE":
      return [];
    case "ACKNOWLEDGE":
      return [
        { id: "ACKNOWLEDGE", filled: true },
        { id: "MORE", filled: false },
      ];
    case "UPDATE":
      return [{ id: "UPDATE", filled: false }];
  }
}

/** The rows of the actions sheet, in order: only what `controls` offers. "I have seen this" is the bar's, not a row. */
export function sheetRows(controls: Controls): Exclude<PanelAction, "ACKNOWLEDGE">[] {
  const rows: Exclude<PanelAction, "ACKNOWLEDGE">[] = [];
  if (controls.assign) rows.push("ASSIGN");
  if (controls.start) rows.push("START");
  if (controls.resolve) rows.push("RESOLVE");
  if (controls.comment) rows.push("COMMENT");
  if (controls.category) rows.push("CATEGORY");
  if (controls.close) rows.push("CLOSE");
  return rows;
}

/** The controls of the one form the sheet shows: every other control off, so the panel draws only that form. */
export function onlyControls(action: Exclude<PanelAction, "ACKNOWLEDGE">): Controls {
  return {
    assign: action === "ASSIGN",
    start: action === "START",
    resolve: action === "RESOLVE",
    comment: action === "COMMENT",
    category: action === "CATEGORY",
    acknowledge: false,
    close: action === "CLOSE",
  };
}
