import { redirect } from "next/navigation";
import { landsOnReport } from "@/domain/auth/staff-landing";
import { legacyFlatsTarget } from "@/lib/reports/ageing";
import { periodFromQuery, periodQuery } from "@/lib/reports/period";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { StaffHomeBanner } from "../../back-link";
import { ReportView } from "./report-view";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/** The committee report. Staff with reports:view only; anyone else is sent away by requireUser, and the loader checks the permission again at the data. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = periodFromQuery(query.period);
  const returnTo = requested === null ? "/staff/reports" : `/staff/reports?period=${periodQuery(requested)}`;
  const user = await requireUser({ need: "reports:view", returnTo });
  // The flats of an age group have a page of their own; an older address with ?bucket= is sent there, with the same order.
  const legacy = legacyFlatsTarget(query);
  if (legacy !== null) redirect(legacy);
  const report = await loadCommitteeReport({ db: defaultDeps().db, user, requestedPeriod: requested, now: businessNow() });
  const committeeOnly = landsOnReport(user.permissions);
  return (
    <>
      {!committeeOnly && <StaffHomeBanner />}
      <ReportView report={report} account={committeeOnly ? { name: user.name, permissions: user.permissions } : undefined} />
    </>
  );
}
