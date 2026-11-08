import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadStaffHome } from "@/server/staff/home-data";
import { StaffView } from "./staff-view";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** Staff only: a resident who opens it is sent to /forbidden by requireUser. The numbers are SELECTs for the tools this person may use (D187). */
export default async function StaffPage() {
  const user = await requireUser({ need: "STAFF", returnTo: "/staff" });
  const home = await loadStaffHome({ db: defaultDeps().db, user, now: businessNow() });
  return <StaffView name={user.name} permissions={user.permissions} home={home} />;
}
