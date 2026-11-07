"use server";

import { z } from "zod";
import { BOARD_VIEWS } from "@/domain/complaints/board-views";
import { CATEGORY_CODES, URGENCIES } from "@/domain/complaints/taxonomy";
import { ASSIGNEE_FILTERS, flatCodePrefix } from "@/lib/staff-complaints/board-query";
import { withPermissionAction } from "@/server/auth/current-user";
import { businessNow } from "@/server/clock";
import { loadBoardMore } from "@/server/complaints/staff-page-data";

const input = z.object({
  view: z.enum(BOARD_VIEWS),
  cursor: z.string().min(1).max(500),
  category: z.enum(CATEGORY_CODES).nullable(),
  assignee: z.enum(ASSIGNEE_FILTERS),
  urgency: z.enum(URGENCIES).nullable(),
  q: z.string().max(8).nullable(),
});

const more = withPermissionAction("complaints:manage", async ({ user, deps }, raw: unknown) => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const { view, cursor, category, assignee, urgency, q } = parsed.data;
  return loadBoardMore({ db: deps.db, user, view, cursor, filters: { category, assignee, urgency, q: q === null ? null : flatCodePrefix(q) }, now: businessNow() });
});

/** "Show 15 more": the next page of a view after `cursor`, with the same filters. The action checks the person itself, because an action is a public endpoint. */
export async function loadMoreComplaints(raw: {
  view: (typeof BOARD_VIEWS)[number];
  cursor: string;
  category: (typeof CATEGORY_CODES)[number] | null;
  assignee: (typeof ASSIGNEE_FILTERS)[number];
  urgency: (typeof URGENCIES)[number] | null;
  q: string | null;
}) {
  return more(raw);
}
