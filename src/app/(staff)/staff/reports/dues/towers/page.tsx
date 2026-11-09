import { towerSortFromQuery, towersHref } from "@/lib/reports/towers";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadTowersPage } from "@/server/reports/towers-page";
import { TowersView } from "../../towers-view";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/** All the towers (D217): `?sort=owed|tower`. Staff with reports:view only, like every committee page, and the loader checks the permission again at the data. */
export default async function DuesTowersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sort = towerSortFromQuery((await searchParams).sort);
  const user = await requireUser({ need: "reports:view", returnTo: towersHref(sort) });
  const page = await loadTowersPage({ db: defaultDeps().db, user, now: businessNow() });
  return <TowersView page={page} sort={sort} />;
}
