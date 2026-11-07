import { periodFromQuery, reportHref } from "@/lib/reports/period";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { ReportView } from "./report-view";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/** The committee report. Staff with reports:view only; anyone else is sent away by requireUser, and the loader checks the permission again at the data. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = periodFromQuery((await searchParams).period);
  const user = await requireUser({ need: "reports:view", returnTo: requested === null ? "/staff/reports" : reportHref({ period: requested }) });
  const report = await loadCommitteeReport({ db: defaultDeps().db, user, requestedPeriod: requested, now: businessNow() });
  return <ReportView report={report} />;
}
