import { cookies } from "next/headers";
import { bucketFromQuery, bucketQuery } from "@/lib/reports/ageing";
import { periodFromQuery, reportHref } from "@/lib/reports/period";
import { VIEW_COOKIE, parseHiddenSections } from "@/lib/reports/sections";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { ReportView } from "./report-view";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/** The committee report. Staff with reports:view only; anyone else is sent away by requireUser, and the loader checks the permission again at the data. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = periodFromQuery(query.period);
  const bucket = bucketFromQuery(query.bucket);
  const returnTo = requested === null ? "/staff/reports" : reportHref({ period: requested, bucket: bucket === null ? null : bucketQuery(bucket) });
  const user = await requireUser({ need: "reports:view", returnTo });
  const report = await loadCommitteeReport({ db: defaultDeps().db, user, requestedPeriod: requested, bucket, now: businessNow() });
  const hidden = parseHiddenSections((await cookies()).get(VIEW_COOKIE)?.value);
  return <ReportView report={report} hidden={hidden} />;
}
