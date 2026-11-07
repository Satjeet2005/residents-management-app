import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadComplaintList } from "@/server/complaints/page-data";
import { ComplaintsView } from "./complaints-view";

export const metadata = { title: "Complaints" };
export const dynamic = "force-dynamic";

/** The resident's complaints. Only a resident: anyone else is sent to /forbidden. Auto-close runs lazily as the list loads (D120). */
export default async function ComplaintsPage() {
  const user = await requireUser({ need: "RESIDENT", returnTo: "/complaints" });
  const data = await loadComplaintList({ db: defaultDeps().db, user, now: businessNow() });
  return <ComplaintsView data={data} />;
}
