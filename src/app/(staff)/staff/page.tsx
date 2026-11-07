import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { loadStaffLanding } from "@/server/complaints/staff-page-data";
import { StaffView } from "./staff-view";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** Staff only: a resident who opens it is sent to /forbidden by requireUser. */
export default async function StaffPage() {
  const user = await requireUser({ need: "STAFF", returnTo: "/staff" });
  const { openSafety } = await loadStaffLanding({ db: defaultDeps().db, user });
  return <StaffView name={user.name} permissions={user.permissions} openSafety={openSafety} />;
}
