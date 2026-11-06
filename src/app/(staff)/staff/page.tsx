import { requireUser } from "@/server/auth/current-user";
import { StaffView } from "./staff-view";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** Staff only: a resident who opens it is sent to /forbidden by requireUser. */
export default async function StaffPage() {
  const user = await requireUser({ need: "STAFF", returnTo: "/staff" });
  return <StaffView name={user.name} permissions={user.permissions} />;
}
