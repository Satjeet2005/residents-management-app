"use server";

import { z } from "zod";
import { withPermissionAction } from "@/server/auth/current-user";
import { loadRowCards } from "@/server/statements/ui-data";
import { AMOUNTS, type RowFilters, REASONS, SORTS } from "@/lib/reconciliation/filters";
import { LANES } from "@/lib/reconciliation/types";

const input = z.object({ importId: z.uuid(), lane: z.enum(LANES), cursor: z.string().max(200), filters: z.object({ sort: z.enum(SORTS), amount: z.enum(AMOUNTS), reason: z.enum(REASONS) }) });

const more = withPermissionAction("payments:match", async ({ user, deps }, raw: unknown) => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  return loadRowCards({ db: deps.db, user, ...parsed.data });
});

/** "Load more": the next page of a lane after `cursor`, in the order and with the filters of the page. The action checks the person itself, because an action is a public endpoint. */
export async function loadMoreRows(raw: { importId: string; lane: (typeof LANES)[number]; cursor: string; filters: RowFilters }) {
  return more(raw);
}
