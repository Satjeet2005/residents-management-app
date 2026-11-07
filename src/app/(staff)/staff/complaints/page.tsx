import { boardHref, parseBoardQuery } from "@/lib/staff-complaints/board-query";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow, isDemoMode } from "@/server/clock";
import { loadBoardPage } from "@/server/complaints/staff-page-data";
import { BoardView } from "./board-view";

export const metadata = { title: "Complaints" };
export const dynamic = "force-dynamic";

/** The complaints board. Staff with complaints:manage only; anyone else is sent away by requireUser, and the loader checks the permission again. */
export default async function ComplaintsBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseBoardQuery(await searchParams);
  const user = await requireUser({ need: "complaints:manage", returnTo: boardHref(query) });
  const page = await loadBoardPage({ db: defaultDeps().db, user, query, now: businessNow() });
  return <BoardView page={page} demo={isDemoMode()} />;
}
