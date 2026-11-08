import { notFound } from "next/navigation";
import { parseFilters } from "@/lib/reconciliation/filters";
import { laneFromQuery, rowFromQuery, workspaceHref } from "@/lib/reconciliation/lanes";
import { requireUser } from "@/server/auth/current-user";
import { businessNow } from "@/server/clock";
import { defaultDeps } from "@/server/auth/default-deps";
import { loadWorkspace } from "@/server/statements/ui-data";
import { WorkspaceView } from "./workspace-view";

export const metadata = { title: "Reconciliation workspace" };
export const dynamic = "force-dynamic";

/** One import: its summary and lanes. Staff with payments:match only; anyone else is sent away by requireUser. */
export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { importId } = await params;
  const query = await searchParams;
  const lane = laneFromQuery(query.lane);
  const rowId = rowFromQuery(query.row);
  const filters = parseFilters(query);
  const user = await requireUser({ need: "payments:match", returnTo: workspaceHref({ importId, lane, row: rowId, filters }) });
  const data = await loadWorkspace({ db: defaultDeps().db, user, importId, lane, rowId, now: businessNow(), filters });
  if (data === null) notFound();
  return <WorkspaceView data={data} lane={lane} viewer={{ id: user.id, role: user.role, active: user.active, permissions: user.permissions }} />;
}
