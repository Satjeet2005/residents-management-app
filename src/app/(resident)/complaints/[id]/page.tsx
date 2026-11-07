import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadComplaintDetail } from "@/server/complaints/page-data";
import { ComplaintView } from "./complaint-view";

export const metadata = { title: "Complaint" };
export const dynamic = "force-dynamic";

/** One complaint of the resident's own flat. Another flat's complaint, a missing one and a bad id are all the same 404 page. */
export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { id } = await params;
  const { sent } = await searchParams;
  const user = await requireUser({ need: "RESIDENT", returnTo: `/complaints/${encodeURIComponent(id)}` });
  const data = await loadComplaintDetail({ db: defaultDeps().db, user, id, now: businessNow() });
  if (data.kind === "NOT_FOUND" || data.kind === "NO_FLAT") notFound();
  return <ComplaintView data={data} sent={sent === "1"} />;
}
