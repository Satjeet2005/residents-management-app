import { notFound, redirect } from "next/navigation";
import { bucketFromQuery, bucketQuery, sortFromQuery, sortQuery } from "@/lib/reports/ageing";
import { istDateOf } from "@/domain/time/calendar";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadAgeingPage } from "@/server/reports/ageing-page";
import { FlatsView } from "../../flats-view";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/**
 * The flats of one age group (D217): `?bucket=1-30|31-60|61-90|over-90` and `?sort=largest|oldest`. Staff with reports:view only, like every committee page, and the loader
 * checks the permission again at the data. A bucket that is not one of the five goes back to the Dues page; a sort that is not "oldest" is the default, largest first.
 */
export default async function DuesFlatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const bucket = bucketFromQuery(query.bucket);
  const sort = sortFromQuery(query.sort);
  const returnTo = bucket === null ? "/staff/reports/dues" : `/staff/reports/dues/flats?bucket=${bucketQuery(bucket)}&sort=${sortQuery(sort)}`;
  const user = await requireUser({ need: "reports:view", returnTo });
  if (bucket === null) redirect("/staff/reports/dues");
  const now = businessNow();
  const page = await loadAgeingPage({ db: defaultDeps().db, user, bucket, sort, now });
  if (page === null) notFound();
  return <FlatsView page={page} bucket={bucket} sort={sort} asOf={istDateOf(now)} />;
}
