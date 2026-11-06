import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { businessNow, isDemoMode } from "@/server/clock";
import { defaultDeps } from "@/server/auth/default-deps";
import { getProfileData } from "@/server/profile/profile-data";
import { ProfileView } from "./profile-view";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser({ returnTo: "/profile" });
  if (user.role === "STAFF") redirect("/staff");
  const data = await getProfileData({ db: defaultDeps().db, user, now: businessNow() });
  return <ProfileView data={data} showDemoNote={isDemoMode()} />;
}
