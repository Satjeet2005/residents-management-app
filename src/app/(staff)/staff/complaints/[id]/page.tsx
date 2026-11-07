import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadComplaintPage } from "@/server/complaints/staff-page-data";
import { ComplaintView } from "./complaint-view";

export const metadata = { title: "Complaint" };
export const dynamic = "force-dynamic";

/** One complaint with its full timeline. Staff with complaints:manage only; a missing complaint and a bad id are the same not-found page. */
export default async function StaffComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser({ need: "complaints:manage", returnTo: `/staff/complaints/${encodeURIComponent(id)}` });
  const page = await loadComplaintPage({ db: defaultDeps().db, user, id, now: businessNow() });
  if (page === null) notFound();
  return <ComplaintView page={page} />;
}
