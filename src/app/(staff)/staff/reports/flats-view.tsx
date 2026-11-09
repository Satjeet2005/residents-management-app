import Link from "next/link";
import { SortChoice } from "@/components/committee/sort-choice";
import { Support } from "@/components/committee/support";
import { ArrowLeftIcon } from "@/components/icons";
import { formatRupeesShort } from "@/domain/money/short";
import type { AgeBucket, AgeingSort } from "@/domain/reports/age";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { bucketLabel, flatsHref } from "@/lib/reports/ageing";
import { countText } from "@/lib/reports/cards";
import { dateWords } from "@/lib/reports/period";
import type { AgeingPage } from "@/server/reports/ageing-page";
import { AgeingList } from "./ageing-list";
import { ArrivalHeading } from "./arrival-heading";

const BACK = "inline-flex min-h-12 items-center gap-2 self-start text-body font-semibold text-accent underline underline-offset-4";

/**
 * The flats of ONE age group, on a page of their own (D217): the back link "Dues" at the top only, the h1 "115 flats owe ₹7.5 lakh" that takes the focus, ONE line
 * "<age group> · as of <date>", ONE line "Flat codes only.", the sort control, and the flats, one line each, 25 at a time. A list this long is never opened inline.
 */
export function FlatsView({ page, bucket, sort, asOf }: { page: AgeingPage; bucket: AgeBucket; sort: AgeingSort; asOf: CalendarDate }) {
  const amount = formatRupeesShort(BigInt(page.amountDuePaise));
  const options = (["LARGEST", "OLDEST"] as const).map((s) => ({
    href: flatsHref(bucket, s),
    label: s === "LARGEST" ? t("committee.drill.sort.largest") : t("committee.drill.sort.oldest"),
    current: s === sort,
  }));
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:gap-6">
      <Link href="/staff/reports/dues" aria-label={t("committee.flats.back.label")} className={BACK}>
        <ArrowLeftIcon size={20} />
        {t("committee.flats.back")}
      </Link>
      <header className="flex flex-col gap-1">
        <ArrivalHeading>{page.flats === 1 ? t("committee.flats.headingOne", { amount }) : t("committee.flats.heading", { n: countText(page.flats), amount })}</ArrivalHeading>
        <Support>{t("committee.flats.line", { bucket: bucketLabel(bucket), date: dateWords(asOf) })}</Support>
        <Support>{t("committee.flats.codes")}</Support>
      </header>
      <SortChoice label={t("committee.drill.sortLabel")} options={options} />
      <AgeingList key={`${bucket}-${sort}`} bucket={bucket} sort={sort} total={page.flats} initialRows={page.rows} initialCursor={page.nextCursor} />
    </main>
  );
}
