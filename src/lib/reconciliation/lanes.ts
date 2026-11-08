import { DEFAULT_FILTERS, type RowFilters } from "./filters";
import { LANES, type Lane } from "./types";
import { t } from "@/lib/messages";

const QUERY_OF: Record<Lane, string> = { NEEDS_YOU: "needs-you", AWAITING_APPROVAL: "awaiting-approval", MATCHED: "posted", NOT_MAINTENANCE: "not-maintenance" };

/** The lane named by `?lane=`; anything else (or nothing) is the first lane. */
export function laneFromQuery(value: string | string[] | undefined): Lane {
  const text = Array.isArray(value) ? value[0] : value;
  return LANES.find((lane) => QUERY_OF[lane] === text) ?? "NEEDS_YOU";
}

export const laneQuery = (lane: Lane): string => QUERY_OF[lane];

/** The address of the workspace with a lane and, optionally, a selected row. The default lane and the default filters are left out so the plain address stays plain. */
export function workspaceHref(input: { importId: string; lane: Lane; row?: string | null; filters?: RowFilters }): string {
  const params = new URLSearchParams();
  if (input.lane !== "NEEDS_YOU") params.set("lane", QUERY_OF[input.lane]);
  const filters = input.filters ?? DEFAULT_FILTERS;
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.amount !== DEFAULT_FILTERS.amount) params.set("amount", filters.amount);
  if (filters.reason !== DEFAULT_FILTERS.reason) params.set("reason", filters.reason);
  if (input.row !== undefined && input.row !== null) params.set("row", input.row);
  const query = params.toString();
  return `/staff/reconciliation/${input.importId}${query === "" ? "" : `?${query}`}`;
}

/** The selected row of `?row=`: only something shaped like an id is kept. */
export function rowFromQuery(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) ? text : null;
}

export function laneLabel(lane: Lane): string {
  switch (lane) {
    case "NEEDS_YOU":
      return t("recon.lane.needsYou");
    case "AWAITING_APPROVAL":
      return t("recon.lane.awaiting");
    case "MATCHED":
      return t("recon.lane.posted");
    case "NOT_MAINTENANCE":
      return t("recon.lane.notMaintenance");
  }
}

/** The tab to move to for an arrow, Home or End key from tab `index` of `count`; null for any other key. Wraps round. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
