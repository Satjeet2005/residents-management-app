import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { getHomeData } from "@/server/home/home-data";
import { HomeView } from "./home-view";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/** The resident Home. A staff member is sent to /staff. The dues are worked out on the business clock (D97). */
export default async function HomePage() {
  const user = await requireUser({ returnTo: "/" });
  if (user.role === "STAFF") redirect("/staff");
  const data = await getHomeData({ db: defaultDeps().db, user, now: businessNow() });
  return <HomeView data={data} />;
}
