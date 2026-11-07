import { type BoardView, DEFAULT_BOARD_VIEW, isBoardView } from "@/domain/complaints/board-views";
import { type CategoryCode, type Urgency, isCategoryCode, isUrgency } from "@/domain/complaints/taxonomy";

/** The first lane names (`?lane=`) still open: old links and tests use them. */
const LANE_ALIAS: Readonly<Record<string, BoardView>> = { "needs-triage": "triage", safety: "safety", open: "open", overdue: "overdue", waiting: "waiting", closed: "closed" };

export const ASSIGNEE_FILTERS = ["anyone", "me", "unassigned"] as const;
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export type BoardFilters = { category: CategoryCode | null; assignee: AssigneeFilter; urgency: Urgency | null; q: string | null };
export const NO_FILTERS: BoardFilters = { category: null, assignee: "anyone", urgency: null, q: null };
export type BoardQuery = { view: BoardView; filters: BoardFilters };

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const SEPARATOR = "[\\s\\-/_.]";
const FLAT_PREFIX = new RegExp(`^T${SEPARATOR}?(\\d{1,2})(?:${SEPARATOR}?(\\d{1,4}))?$`);

/**
 * A flat-code search as the canonical prefix to look for: "t12-04", "T12 04", "t12/04" and "t1204" are all "T12-04". The text is 2 to 8 characters, must start
 * with the letter T (as the flat-code parser requires) and may split the tower and the rest by one separator (space, hyphen, slash, underscore or dot). A
 * tower of one digit is zero-padded ("t5" is "T05") and a three digit unit part too ("t12 408" is "T12-0408"). Anything else is null (ignored).
 */
export function flatCodePrefix(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 8) return null;
  const match = FLAT_PREFIX.exec(trimmed.toUpperCase());
  if (match === null) return null;
  const [, tower, rest] = match;
  const towerText = tower.padStart(2, "0");
  if (rest === undefined) return `T${towerText}`;
  return `T${towerText}-${rest.length === 3 ? rest.padStart(4, "0") : rest}`;
}

/**
 * The board's address as a view and filters. Every value is checked against a list; a value that is not on it (hostile, misspelt, repeated, too long) is
 * IGNORED and the default is used, never an error. `view` wins over the old `lane`; with neither, the view is needs_action.
 */
export function parseBoardQuery(params: Record<string, string | string[] | undefined>): BoardQuery {
  const view = first(params.view);
  const lane = first(params.lane);
  const category = first(params.category);
  const assignee = first(params.assignee);
  const urgency = first(params.urgency);
  const q = first(params.q);
  return {
    view: isBoardView(view) ? view : lane !== undefined && Object.hasOwn(LANE_ALIAS, lane) ? LANE_ALIAS[lane] : DEFAULT_BOARD_VIEW,
    filters: {
      category: isCategoryCode(category) ? category : null,
      assignee: (ASSIGNEE_FILTERS as readonly (string | undefined)[]).includes(assignee) ? (assignee as AssigneeFilter) : "anyone",
      urgency: isUrgency(urgency) ? urgency : null,
      q: q === undefined ? null : flatCodePrefix(q),
    },
  };
}

/** The query string of a view and filters (only what differs from the defaults), for the links of the board. */
export function boardQueryString(query: BoardQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  params.set("view", query.view);
  if (query.filters.category !== null) params.set("category", query.filters.category);
  if (query.filters.assignee !== "anyone") params.set("assignee", query.filters.assignee);
  if (query.filters.urgency !== null) params.set("urgency", query.filters.urgency);
  if (query.filters.q !== null) params.set("q", query.filters.q);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

export const boardHref = (query: BoardQuery): string => `/staff/complaints?${boardQueryString(query)}`;
export const hasFilters = (filters: BoardFilters): boolean => filters.category !== null || filters.assignee !== "anyone" || filters.urgency !== null || filters.q !== null;
