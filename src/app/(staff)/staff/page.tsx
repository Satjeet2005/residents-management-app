import { redirect } from "next/navigation";
import { landsOnReport } from "@/domain/auth/staff-landing";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadStaffHome } from "@/server/staff/home-data";
import { StaffView } from "./staff-view";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/**
 * Staff only: a resident who opens it is sent to /forbidden by requireUser. A person whose only tool is the committee report has nothing to choose, so they go straight to
 * the report (D236). The numbers and rows are SELECTs for the tools this person may use (D187, D237).
 */
export default async function StaffPage() {
  const user = await requireUser({ need: "STAFF", returnTo: "/staff" });
  if (landsOnReport(user.permissions)) redirect("/staff/reports");
  const now = businessNow();
  const home = await loadStaffHome({ db: defaultDeps().db, user, now });
  return <StaffView name={user.name} permissions={user.permissions} home={home} now={now} />;
}
