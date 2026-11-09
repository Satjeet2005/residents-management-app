import { notFound, redirect } from "next/navigation";
import { legacyFlatsTarget } from "@/lib/reports/ageing";
import { periodFromQuery, periodQuery } from "@/lib/reports/period";
import { sectionFromSlug } from "@/lib/reports/sections";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { businessNow } from "@/server/clock";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { SectionPage } from "../section-page";

export const metadata = { title: "Committee report" };
export const dynamic = "force-dynamic";

/**
 * One section page of the committee report (collections, dues, complaints, bank). Staff with reports:view only, exactly like the overview; an address that is not
 * one of the four is a 404. An old inline address of the Dues page (`?bucket=`) goes to the flats page (D217).
 */
export default async function ReportSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const slug = sectionFromSlug((await params).section);
  if (slug === null) notFound();
  const query = await searchParams;
  const requested = periodFromQuery(query.period);
  const returnTo = `/staff/reports/${slug}${requested === null ? "" : `?period=${periodQuery(requested)}`}`;
  const user = await requireUser({ need: "reports:view", returnTo });
  const legacy = slug === "dues" ? legacyFlatsTarget(query) : null;
  if (legacy !== null) redirect(legacy);
  const report = await loadCommitteeReport({ db: defaultDeps().db, user, requestedPeriod: requested, now: businessNow() });
  return <SectionPage slug={slug} report={report} />;
}
