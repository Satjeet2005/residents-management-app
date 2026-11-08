import Link from "next/link";
import { cx } from "@/components/ui/cx";
import { formatRupeesShort } from "@/domain/money/short";
import type { AgeingSort } from "@/domain/reports/age";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { bucketLabel, bucketQuery, sortQuery } from "@/lib/reports/ageing";
import { countText } from "@/lib/reports/cards";
import { reportHref } from "@/lib/reports/period";
import type { AgeingPage } from "@/server/reports/ageing-page";
import { AgeingList } from "./ageing-list";
import { DrillHeading } from "./drill-heading";

const BACK = "inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4";

/**
 * The drill-down of one age group, below the ageing list (the address has `?bucket=`): its heading "115 flats owe ₹7.5 lakh (Over 90 days)" that takes the focus, the
 * choice between Largest first (the default) and Oldest first, the flats, and a way back to the age groups at the top and at the bottom.
 */
export function AgeingDetail({ page, period }: { page: AgeingPage; period: CalendarDate }) {
  const back = (
    <Link href={reportHref({ period, toAges: true })} className={BACK}>
      {t("committee.drill.back")}
    </Link>
  );
  const amount = formatRupeesShort(BigInt(page.amountDuePaise));
  const sorts: { sort: AgeingSort; label: string }[] = [
    { sort: "LARGEST", label: t("committee.drill.sort.largest") },
    { sort: "OLDEST", label: t("committee.drill.sort.oldest") },
  ];
  return (
    <section id="ageing-detail" aria-labelledby="committee-drill" className="flex flex-col gap-3">
      {back}
      <div className="flex flex-col gap-1">
        <DrillHeading id="committee-drill">
          {page.flats === 1 ? t("committee.drill.headingOne", { amount, bucket: bucketLabel(page.bucket) }) : t("committee.drill.heading", { n: countText(page.flats), amount, bucket: bucketLabel(page.bucket) })}
        </DrillHeading>
        <p className="text-body text-ink-2">{t("committee.drill.hint")}</p>
      </div>
      <nav aria-label={t("committee.drill.sortLabel")} className="flex flex-wrap gap-2">
        {sorts.map(({ sort, label }) => (
          <Link
            key={sort}
            href={reportHref({ period, bucket: bucketQuery(page.bucket), sort: sortQuery(sort) })}
            aria-current={page.sort === sort ? "true" : undefined}
            className={cx("inline-flex min-h-12 items-center rounded-control border-2 px-4 text-body", page.sort === sort ? "border-ink font-semibold" : "border-control text-accent underline underline-offset-4")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <AgeingList key={`${page.bucket}-${page.sort}`} bucket={page.bucket} sort={page.sort} total={page.flats} initialRows={page.rows} initialCursor={page.nextCursor} />
      {back}
    </section>
  );
}
