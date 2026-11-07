import Link from "next/link";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { bucketLabel } from "@/lib/reports/ageing";
import { reportHref } from "@/lib/reports/period";
import type { AgeingPage } from "@/server/reports/ageing-page";
import { AgeingList } from "./ageing-list";

/** The drill-down of one age group, below the ageing block (the address has `?bucket=`): its flats, oldest first, with a way to close it. */
export function AgeingDetail({ page, period }: { page: AgeingPage; period: CalendarDate }) {
  return (
    <section id="ageing-detail" aria-labelledby="committee-drill" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="committee-drill" className="text-title font-semibold">
          {t("committee.drill.heading", { bucket: bucketLabel(page.bucket) })}
        </h2>
        <p className="text-body text-ink-2">{t("committee.drill.hint")}</p>
      </div>
      <AgeingList key={page.bucket} bucket={page.bucket} initialRows={page.rows} initialCursor={page.nextCursor} />
      <Link href={reportHref({ period })} className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
        {t("committee.drill.close")}
      </Link>
    </section>
  );
}
