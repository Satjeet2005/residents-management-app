"use server";

import { z } from "zod";
import { BOARD_LANES } from "@/lib/staff-complaints/lanes";
import { withPermissionAction } from "@/server/auth/current-user";
import { businessNow } from "@/server/clock";
import { loadBoardMore } from "@/server/complaints/staff-page-data";

const input = z.object({ lane: z.enum(BOARD_LANES), cursor: z.string().min(1).max(500) });

const more = withPermissionAction("complaints:manage", async ({ user, deps }, raw: unknown) => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  return loadBoardMore({ db: deps.db, user, ...parsed.data, now: businessNow() });
});

/** "Load more": the next page of a lane after `cursor`. The action checks the person itself, because an action is a public endpoint. */
export async function loadMoreComplaints(raw: { lane: (typeof BOARD_LANES)[number]; cursor: string }) {
  return more(raw);
}
