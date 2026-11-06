import { notFound } from "next/navigation";
import { laneFromQuery, rowFromQuery, workspaceHref } from "@/lib/reconciliation/lanes";
import { requireUser } from "@/server/auth/current-user";
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
  const user = await requireUser({ need: "payments:match", returnTo: workspaceHref({ importId, lane, row: rowFromQuery(query.row) }) });
  const data = await loadWorkspace({ db: defaultDeps().db, user, importId, lane });
  if (data === null) notFound();
  return <WorkspaceView data={data} lane={lane} />;
}
